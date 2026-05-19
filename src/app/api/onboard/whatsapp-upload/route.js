import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

import { NextResponse } from "next/server";

import { parseWhatsAppExport } from "@/lib/kb/whatsapp-parser";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

/** 5 MiB limit per WhatsApp export. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * @typedef {{
 *   brokerageName: string,
 *   agentName: string,
 * }} LeadInferenceContext
 */

/** @returns {Promise<void>} */
async function rebuildKbIndex() {
  const scriptPath = path.join(process.cwd(), "scripts", "build-kb-index.js");
  await execFileAsync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
}

/**
 * @param {unknown} entry
 */
function isFileUpload(entry) {
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof entry.arrayBuffer === "function" &&
    typeof entry.name === "string"
  );
}

/**
 * Gather uploads from multipart fields "files" (may repeat) and "file".
 *
 * @param {FormData} formData
 */
function collectTxtInputs(formData) {
  const list = [];
  for (const entry of formData.getAll("files")) {
    if (isFileUpload(entry)) list.push(entry);
  }
  const single = formData.get("file");
  if (isFileUpload(single)) list.push(single);
  return list;
}

/**
 * @param {string} agentIdRaw
 */
function sanitizeAgentSlug(agentIdRaw) {
  return agentIdRaw
    .normalize("NFKC")
    .trim()
    .replace(/[^\w\-.]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64)
    .toLowerCase();
}

/**
 * @param {unknown} p
 */
function participantKey(p) {
  if (typeof p === "string") return p.trim();
  if (p == null) return "";
  return String(p).trim();
}

/**
 * @param {string} s
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Identity compare: strip parentheticals, normalise whitespace (for agent vs participant name).
 *
 * @param {string} raw
 */
function normalizeNameForMatch(raw) {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(/\([^)]*\)/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * WhatsApp export line is agent-side if it mentions the roster brokerage, legacy Sterling,
 * or matches the selected agent's display name.
 *
 * @param {unknown} participant
 * @param {LeadInferenceContext} ctx
 */
function isAgentSideParticipant(participant, ctx) {
  const s = participantKey(participant);
  if (!s) return false;
  if (ctx.brokerageName && ctx.brokerageName.length > 0) {
    if (s.toLowerCase().includes(ctx.brokerageName.toLowerCase())) return true;
  }
  if (/sterling boulevard/i.test(s)) return true;
  const normParticipant = normalizeNameForMatch(s);
  const normAgent = normalizeNameForMatch(ctx.agentName);
  if (normAgent.length > 0 && normParticipant === normAgent) return true;
  return false;
}

/**
 * Strip "(<brokerage>)" and legacy "(Sterling Boulevard)" for API labels only (saved file unchanged).
 *
 * @param {unknown} raw
 * @param {string} brokerageName
 */
function stripBrokerageParenthetical(raw, brokerageName) {
  let out = String(raw ?? "").normalize("NFKC");
  if (brokerageName && brokerageName.trim()) {
    const re = new RegExp(
      `\\s*\\(${escapeRegExp(brokerageName.trim())}\\)\\s*`,
      "gi",
    );
    out = out.replace(re, " ");
  }
  out = out
    .replace(/\s*\([^)]*Sterling[^)]*Boulevard[^)]*\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return out;
}

/**
 * Lead segment: filesystem-safe, single token (hyphens, no underscores).
 *
 * @param {string} raw
 * @param {string} brokerageName
 */
function sanitizeLeadHyphenSlug(raw, brokerageName) {
  const s = stripBrokerageParenthetical(raw, brokerageName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return s || "unknown-lead";
}

/**
 * First participant that is not agent-side, else unknown-lead.
 * Does not fall back to an agent/brokerage participant as the lead.
 *
 * @param {*} meta - parseWhatsAppExport()[0]
 * @param {LeadInferenceContext} ctx
 */
function inferLeadName(meta, ctx) {
  const participants = Array.isArray(meta?.participants) ? meta.participants : [];
  for (const p of participants) {
    if (!participantKey(p)) continue;
    if (isAgentSideParticipant(p, ctx)) continue;
    const slug = sanitizeLeadHyphenSlug(p, ctx.brokerageName);
    if (slug && slug !== "unknown-lead") return slug;
  }
  return "unknown-lead";
}

/**
 * Participants for JSON responses: strip brokerage parentheticals, preserve order (all participants).
 *
 * @param {string[] | undefined} participants
 * @param {string} brokerageName
 * @returns {string[]}
 */
function participantsForApiResponse(participants, brokerageName) {
  if (!Array.isArray(participants)) return [];
  const out = [];
  for (const p of participants) {
    const label = stripBrokerageParenthetical(participantKey(p), brokerageName);
    if (label) out.push(label);
  }
  return out;
}

/**
 * `<agentId>_<leadName>_<timestamp>.txt` only. If the path exists, retry with a new timestamp.
 *
 * @param {string} targetDir
 * @param {string} agentSlug
 * @param {string} leadSlug
 */
async function allocateBriefWhatsappFilename(targetDir, agentSlug, leadSlug) {
  const a = agentSlug;
  const lead = leadSlug || "unknown-lead";
  for (let attempt = 0; attempt < 10000; attempt++) {
    const stamp = Date.now() + attempt;
    const name = `${a}_${lead}_${stamp}.txt`;
    try {
      await fs.access(path.join(targetDir, name));
    } catch {
      return name;
    }
  }
  throw new Error("Could not allocate a unique export filename.");
}

/**
 * Normalize a participant name for deduplication.
 * @param {unknown} p
 */
function participantKeyForLeads(p) {
  if (typeof p === "string") return p.trim();
  if (p == null) return "";
  return String(p).trim();
}

/**
 * Lead labels for API: non–agent-side participants only, stripped for display.
 *
 * @param {string[] | undefined} participants
 * @param {LeadInferenceContext} ctx
 * @returns {string[]}
 */
function leadsForFile(participants, ctx) {
  if (!Array.isArray(participants)) return [];
  const ordered = [];
  const seen = new Set();
  for (const p of participants) {
    if (isAgentSideParticipant(p, ctx)) continue;
    const label = stripBrokerageParenthetical(
      participantKeyForLeads(p),
      ctx.brokerageName,
    );
    if (!label || seen.has(label)) continue;
    seen.add(label);
    ordered.push(label);
  }
  return ordered;
}

/**
 * Load roster brokerage and agent display name for lead inference.
 *
 * @param {string} agentId
 * @returns {Promise<LeadInferenceContext | null>}
 */
async function loadLeadInferenceContext(agentId) {
  const agentsPath = path.join(process.cwd(), "data", "agents.json");
  const raw = await fs.readFile(agentsPath, "utf-8");
  const data = JSON.parse(raw);
  const brokerageRaw = data?.brokerage;
  const brokerageName =
    typeof brokerageRaw === "string" ? brokerageRaw.trim() : "";
  const agents = Array.isArray(data?.agents) ? data.agents : [];
  const agent = agents.find(
    (a) =>
      a &&
      typeof a === "object" &&
      typeof a.id === "string" &&
      a.id.trim() === agentId.trim(),
  );
  if (!agent || typeof agent.name !== "string" || !agent.name.trim()) {
    return null;
  }
  return {
    brokerageName,
    agentName: agent.name.trim(),
  };
}

/**
 * Dedupe `leads` from each file result (non–agent-side only, already in `fr.leads`).
 *
 * @param {{ leads?: string[] }[]} fileResults
 * @returns {string[]}
 */
function uniqueLeadsAcrossFiles(fileResults) {
  const ordered = [];
  const seen = new Set();
  for (const fr of fileResults) {
    if (!Array.isArray(fr.leads)) continue;
    for (const label of fr.leads) {
      if (!label || seen.has(label)) continue;
      seen.add(label);
      ordered.push(label);
    }
  }
  return ordered;
}

export async function POST(request) {
  const { isOnboardSessionValid, onboardUnauthorizedResponse } = await import(
    "@/lib/require-onboard-session"
  );
  if (!(await isOnboardSessionValid())) {
    return onboardUnauthorizedResponse();
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Could not parse form data. Send multipart/form-data.",
      },
      { status: 400 },
    );
  }

  const agentField = formData.get("agentId");
  const agentId =
    typeof agentField === "string" ? agentField.trim() : "";
  if (!agentId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "agentId is required. Choose a roster agent so exports are saved with the correct agent-linked filename.",
      },
      { status: 400 },
    );
  }
  const agentSlug = sanitizeAgentSlug(agentId);
  if (!agentSlug) {
    return NextResponse.json(
      {
        success: false,
        error:
          "agentId is invalid. Use letters, numbers, hyphens, dots, or underscores.",
      },
      { status: 400 },
    );
  }

  let leadCtx;
  try {
    leadCtx = await loadLeadInferenceContext(agentId);
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "Could not load agent roster from data/agents.json. Ensure the file exists and is valid JSON.",
      },
      { status: 500 },
    );
  }
  if (!leadCtx) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unknown agentId. No matching agent with a name was found in data/agents.json.",
      },
      { status: 400 },
    );
  }

  const uploads = collectTxtInputs(formData);
  if (uploads.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error:
          'No files received. Attach at least one .txt export using the "files" or "file" field.',
      },
      { status: 400 },
    );
  }

  const validationProblems = [];
  for (let i = 0; i < uploads.length; i++) {
    const blob = uploads[i];
    const displayName =
      blob.name && blob.name.trim() ? blob.name : `attachment_${i + 1}`;
    const lowerName = displayName.toLowerCase();
    if (!lowerName.endsWith(".txt")) {
      validationProblems.push(
        `"${displayName}" is not allowed (only .txt exports).`,
      );
      continue;
    }
    if (blob.size > MAX_FILE_BYTES) {
      validationProblems.push(
        `"${displayName}" is too large (${Math.round(blob.size / (1024 * 1024))}MB). Limit is ${MAX_FILE_BYTES / (1024 * 1024)}MB.`,
      );
    }
  }
  if (validationProblems.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: validationProblems.join(" "),
        details: validationProblems,
      },
      { status: 400 },
    );
  }

  const targetDir = path.join(process.cwd(), "data", "whatsapp");
  await fs.mkdir(targetDir, { recursive: true });

  /** @type {{ originalName: string, savedAs: string, messageCount: number, participants: string[], leads: string[] }[]} */
  const fileResults = [];

  try {
    for (let index = 0; index < uploads.length; index++) {
      const blob = uploads[index];
      const originalName =
        blob.name && blob.name.trim() ? blob.name : `attachment_${index + 1}`;
      const text = await blob.text();
      let meta;
      try {
        meta = parseWhatsAppExport(text, agentId, {
          filename: originalName,
        })[0];
      } catch (parseErr) {
        const message =
          parseErr instanceof Error
            ? parseErr.message
            : "WhatsApp parser rejected this file.";
        return NextResponse.json(
          {
            success: false,
            error: `Could not interpret "${originalName}". ${message}`,
          },
          { status: 400 },
        );
      }

      const leadName = inferLeadName(meta, leadCtx);
      const savedAs = await allocateBriefWhatsappFilename(
        targetDir,
        agentSlug,
        leadName,
      );
      const absPath = path.join(targetDir, savedAs);

      await fs.writeFile(absPath, text, "utf-8");

      fileResults.push({
        originalName,
        savedAs,
        messageCount: meta.messageCount,
        participants: participantsForApiResponse(
          meta.participants,
          leadCtx.brokerageName,
        ),
        leads: leadsForFile(meta.participants, leadCtx),
      });
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed saving export files.";
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 },
    );
  }

  try {
    await rebuildKbIndex();
    const { clearKbCache } = await import("@/lib/kb/loader");
    clearKbCache();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown rebuild failure.";
    return NextResponse.json(
      {
        success: false,
        error: `Files were saved but the KB index could not be rebuilt. ${message}`,
        filesUploaded: fileResults.length,
        docsAdded: fileResults.length,
        files: fileResults,
        leads: uniqueLeadsAcrossFiles(fileResults),
      },
      { status: 500 },
    );
  }

  const leads = uniqueLeadsAcrossFiles(fileResults);

  return NextResponse.json({
    success: true,
    filesUploaded: fileResults.length,
    docsAdded: fileResults.length,
    files: fileResults,
    leads,
  });
}
