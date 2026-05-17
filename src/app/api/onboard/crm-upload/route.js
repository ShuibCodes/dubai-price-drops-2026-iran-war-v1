import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

import { NextResponse } from "next/server";

import { parseCrmCsv } from "@/lib/kb/crm-csv-parser";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

/** 5 MiB per CSV. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Limit how many per-row errors we surface in the API response. */
const MAX_REPORTED_ERRORS = 25;

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
 * @param {FormData} formData
 */
function collectCsvInputs(formData) {
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
 * @param {string} agentId
 * @returns {Promise<{ brokerageName: string, agentName: string } | null>}
 */
async function loadAgentContext(agentId) {
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
 * @param {string} targetDir
 * @param {string} agentSlug
 */
async function allocateCrmFilename(targetDir, agentSlug) {
  for (let attempt = 0; attempt < 10000; attempt++) {
    const stamp = Date.now() + attempt;
    const name = `${agentSlug}_${stamp}.jsonl`;
    try {
      await fs.access(path.join(targetDir, name));
    } catch {
      return name;
    }
  }
  throw new Error("Could not allocate a unique CRM filename.");
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
          "agentId is required. Choose a roster agent so the CRM file is linked to the right agent.",
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

  let agentCtx;
  try {
    agentCtx = await loadAgentContext(agentId);
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
  if (!agentCtx) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unknown agentId. No matching agent with a name was found in data/agents.json.",
      },
      { status: 400 },
    );
  }

  const uploads = collectCsvInputs(formData);
  if (uploads.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error:
          'No files received. Attach at least one .csv file using the "files" or "file" field.',
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
    if (!lowerName.endsWith(".csv")) {
      validationProblems.push(
        `"${displayName}" is not allowed (only .csv exports).`,
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

  const targetDir = path.join(process.cwd(), "data", "crm");
  await fs.mkdir(targetDir, { recursive: true });

  /** @type {{ originalName: string, savedAs: string, rowsTotal: number, rowsImported: number, rowsSkipped: number, headerMap: Record<string,string>, unmappedHeaders: string[], errors: { row: number, message: string }[] }[]} */
  const fileResults = [];
  /** @type {string[]} */
  const allLeadNames = [];
  const seenLeadNames = new Set();

  try {
    for (let index = 0; index < uploads.length; index++) {
      const blob = uploads[index];
      const originalName =
        blob.name && blob.name.trim() ? blob.name : `attachment_${index + 1}`;
      const text = await blob.text();

      const result = parseCrmCsv(text);

      const blockingErrors = result.errors.filter(
        (e) => e.row === 0 && e.message.startsWith("Missing required column"),
      );
      if (blockingErrors.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `Could not import "${originalName}". ${blockingErrors.map((e) => e.message).join(" ")}`,
            details: blockingErrors,
          },
          { status: 400 },
        );
      }

      if (result.records.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: `"${originalName}" contained no importable rows. Check the file has a header row and at least one data row with a name.`,
            details: result.errors.slice(0, MAX_REPORTED_ERRORS),
          },
          { status: 400 },
        );
      }

      const savedAs = await allocateCrmFilename(targetDir, agentSlug);
      const absPath = path.join(targetDir, savedAs);

      const stamp = new Date().toISOString();
      const meta = {
        type: "crm-metadata",
        agentId,
        agentName: agentCtx.agentName,
        brokerage: agentCtx.brokerageName,
        originalFilename: originalName,
        importedAt: stamp,
        headerMap: result.headerMap,
        unmappedHeaders: result.unmappedHeaders,
        rowsTotal: result.rowsTotal,
        rowsImported: result.rowsImported,
        rowsSkipped: result.rowsSkipped,
      };

      const lines = [JSON.stringify(meta)];
      for (const rec of result.records) {
        lines.push(
          JSON.stringify({
            type: "crm-lead",
            agentId,
            ...rec,
          }),
        );
        if (rec.name && !seenLeadNames.has(rec.name)) {
          seenLeadNames.add(rec.name);
          allLeadNames.push(rec.name);
        }
      }

      await fs.writeFile(absPath, `${lines.join("\n")}\n`, "utf-8");

      fileResults.push({
        originalName,
        savedAs,
        rowsTotal: result.rowsTotal,
        rowsImported: result.rowsImported,
        rowsSkipped: result.rowsSkipped,
        headerMap: result.headerMap,
        unmappedHeaders: result.unmappedHeaders,
        errors: result.errors.slice(0, MAX_REPORTED_ERRORS),
      });
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed saving CRM files.";
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
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown rebuild failure.";
    return NextResponse.json(
      {
        success: false,
        error: `Files were saved but the KB index could not be rebuilt. ${message}`,
        filesUploaded: fileResults.length,
        files: fileResults,
        leads: allLeadNames.slice(0, 200),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    filesUploaded: fileResults.length,
    files: fileResults,
    leads: allLeadNames.slice(0, 200),
    totals: {
      rowsTotal: fileResults.reduce((a, f) => a + f.rowsTotal, 0),
      rowsImported: fileResults.reduce((a, f) => a + f.rowsImported, 0),
      rowsSkipped: fileResults.reduce((a, f) => a + f.rowsSkipped, 0),
    },
  });
}
