import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const EMPTY_ROSTER = { brokerage: "", agents: [] };

/** New uploads: `<agentId>_<leadName>_<timestamp>.txt`; legacy `slug__...` filenames. */
function sanitizeAgentSlug(agentIdRaw) {
  return String(agentIdRaw ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/[^\w\-.]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64)
    .toLowerCase();
}

/**
 * Indexed WhatsApp KB docs for this roster. Assignment (exactly one agent or none):
 * - If entry.agentId matches a roster agent id → that agent.
 * - Else if agentId is absent/blank → basename must start with `{sanitizeAgentSlug(id)}_`
 *   (upload convention); longest slug wins.
 * - Else (orphan agentId, or no prefix) → not counted for any agent.
 *
 * @param {Array<{ id?: unknown }>} agents
 * @returns {Promise<Map<string, number>>}
 */
async function computePerAgentKbFromIndex(agents) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const agent of agents) {
    const id = typeof agent?.id === "string" ? agent.id : "";
    counts.set(id, 0);
  }

  const indexPath = path.join(process.cwd(), "data", "index.json");
  let index;
  try {
    const raw = await fs.readFile(indexPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return counts;
    index = parsed;
  } catch {
    return counts;
  }

  const slugRows = agents
    .map((agent) => {
      const id = typeof agent?.id === "string" ? agent.id : "";
      const slug = sanitizeAgentSlug(id);
      return { id, slug };
    })
    .filter((row) => row.slug.length > 0);

  for (const entry of index) {
    if (!entry || typeof entry !== "object") continue;
    const fileStr = typeof entry.file === "string" ? entry.file : "";
    const normPath = fileStr.replace(/\\/g, "/");
    const isWhatsApp =
      entry.type === "whatsapp" ||
      (normPath.includes("/whatsapp/") && normPath.toLowerCase().endsWith(".txt"));
    if (!isWhatsApp) continue;

    const basename = path.basename(normPath).toLowerCase();

    const rawEntryAgentId = entry.agentId;
    const entryAgentId =
      typeof rawEntryAgentId === "string" ? rawEntryAgentId.trim() : "";

    let assignedId = null;

    if (entryAgentId !== "") {
      for (const rosterId of counts.keys()) {
        if (
          rosterId === entryAgentId ||
          sanitizeAgentSlug(rosterId) === entryAgentId
        ) {
          assignedId = rosterId;
          break;
        }
      }
    } else {
      let bestId = null;
      let bestSlugLen = -1;
      for (const { id, slug } of slugRows) {
        const prefix = `${slug}_`;
        if (basename.startsWith(prefix) && slug.length > bestSlugLen) {
          bestId = id;
          bestSlugLen = slug.length;
        }
      }
      assignedId = bestId;
    }

    if (assignedId != null) {
      counts.set(assignedId, (counts.get(assignedId) ?? 0) + 1);
    }
  }

  return counts;
}

/** Prefer indexed document count; otherwise count WhatsApp .txt on disk. */
async function computeKbFilesLoaded() {
  const dataDir = path.join(process.cwd(), "data");
  const indexPath = path.join(dataDir, "index.json");
  try {
    const raw = await fs.readFile(indexPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.length;
  } catch {
    /* missing or invalid index.json */
  }
  try {
    const waDir = path.join(dataDir, "whatsapp");
    const names = await fs.readdir(waDir);
    return names.filter((n) => n.toLowerCase().endsWith(".txt")).length;
  } catch {
    return 0;
  }
}

/**
 * Roster JSON on disk is only brokerage + agents. kbFilesLoaded on disk is ignored;
 * per-agent KB counts are derived from data/index.json (see computePerAgentKbFromIndex).
 *
 * @param {unknown} rawAgent
 */
function sanitizeAgentFromFile(rawAgent) {
  if (!rawAgent || typeof rawAgent !== "object" || Array.isArray(rawAgent)) {
    return {};
  }
  const { kbFilesLoaded: _drop, ...rest } = rawAgent;
  return rest;
}

export async function GET() {
  const filePath = path.join(process.cwd(), "data", "agents.json");
  const kbFilesLoaded = await computeKbFilesLoaded();

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const brokerage =
      typeof parsed.brokerage === "string" ? parsed.brokerage : "";
    const agents = Array.isArray(parsed.agents)
      ? parsed.agents.map(sanitizeAgentFromFile)
      : [];
    const perAgentKb = await computePerAgentKbFromIndex(agents);
    const agentsWithKb = agents.map((a) => {
      const id = typeof a?.id === "string" ? a.id : "";
      const n = perAgentKb.get(id) ?? 0;
      return { ...a, kbFilesLoaded: n };
    });
    return NextResponse.json({
      brokerage,
      agents: agentsWithKb,
      kbFilesLoaded,
    });
  } catch {
    return NextResponse.json({
      ...EMPTY_ROSTER,
      kbFilesLoaded,
    });
  }
}
