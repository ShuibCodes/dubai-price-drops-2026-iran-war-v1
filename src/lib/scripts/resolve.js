import { getSupabaseServerClient } from "../supabase/server.js";

const SIM_THRESHOLD = 0.4;
const AMBIGUOUS_DELTA = 0.1;
/** Same ceiling as DAILY_BATCH_CAP — confirm copy must not promise more than a day. */
const CONFIRM_COUNT_CAP = 200;

/**
 * Confirm-copy estimate only — not a bill.
 *
 * `calls.duration_seconds` is unused (null on 1416). Per-call cost is stored
 * on Vapi end-of-call reports at `raw.message.cost` (USD). Snapshot 2026-08-20,
 * 1416 outbound, n=969 numeric costs (no-answer ≈ $0, voicemail ≈ $0.011,
 * connected mixed). UAE peg 3.6725 AED/USD.
 *
 * 340 leads → 340 × 0.025321 × 3.6725 ≈ 31.6 AED, shown as 32.
 */
export const ESTIMATED_USD_PER_OUTBOUND_DIAL = 0.025321;
export const USD_TO_AED = 3.6725;

export function estimateBatchAed(leadCount) {
  const n = Number(leadCount) || 0;
  return n * ESTIMATED_USD_PER_OUTBOUND_DIAL * USD_TO_AED;
}

function db() {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");
  return supabase;
}

function foldName(value) {
  return String(value || "").trim().toLowerCase();
}

function publicMatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    display_name: row.display_name,
    status: row.status,
    current_version: Number(row.current_version) || 0,
    published_at: row.published_at || null,
    sim: row.sim == null ? null : Number(row.sim),
  };
}

function namesOf(rows) {
  return [...new Set(rows.map((row) => row.display_name))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function exactHits(rows, phrase) {
  const target = foldName(phrase);
  return rows.filter((row) => foldName(row.display_name) === target);
}

function distinctiveFirstWord(displayName) {
  const parts = String(displayName || "")
    .split(/[\s—–]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    const token = part.replace(/[^\p{L}\p{N}-]+/gu, "");
    if (token.length >= 3) return token;
  }
  return parts[0] || "";
}

function firstWordHits(rows, phrase) {
  const hay = ` ${foldName(phrase).replace(/[-—–]/g, " ")} `;
  return rows.filter((row) => {
    const word = distinctiveFirstWord(row.display_name);
    if (word.length < 3) return false;
    const needle = word.toLowerCase().replace(/[-—–]/g, " ").trim();
    return Boolean(needle) && hay.includes(` ${needle} `);
  });
}

function rankedBySim(rows) {
  return [...rows].sort((a, b) => Number(b.sim || 0) - Number(a.sim || 0));
}

function pickLiveBySimilarity(live) {
  const ranked = rankedBySim(live.filter((row) => Number(row.sim) >= SIM_THRESHOLD));
  if (!ranked.length) return null;
  if (
    ranked.length >= 2 &&
    Number(ranked[0].sim) - Number(ranked[1].sim) <= AMBIGUOUS_DELTA
  ) {
    return {
      match: null,
      alternatives: ranked.slice(0, 2).map(publicMatch),
      reason: "ambiguous",
    };
  }
  return { match: publicMatch(ranked[0]), alternatives: [], reason: "matched" };
}

function withLists(partial, live, drafts) {
  return {
    match: null,
    alternatives: [],
    ...partial,
    liveNames: namesOf(live),
    unpublishedNames: namesOf(drafts),
  };
}

/**
 * Match a spoken/typed script name for a tenant.
 * Migrated Live — * pointers are not candidates (RPC excludes is_migrated).
 * Live match only when status is live. Draft hits return not_published.
 */
export async function resolveScript({ tenantId, phrase }) {
  const trimmed = String(phrase || "").trim();
  const { data, error } = await db().rpc("script_resolve_candidates", {
    p_tenant_id: tenantId,
    p_phrase: trimmed,
  });
  if (error) throw new Error(`Script resolve failed: ${error.message}`);

  const rows = data || [];
  const live = rows.filter((row) => row.status === "live");
  const drafts = rows.filter((row) => row.status === "draft");

  if (!trimmed) {
    return withLists({ reason: "not_found" }, live, drafts);
  }

  const exactLive = exactHits(live, trimmed);
  if (exactLive.length === 1) {
    return withLists(
      { match: publicMatch(exactLive[0]), reason: "matched" },
      live,
      drafts
    );
  }
  if (exactLive.length > 1) {
    return withLists(
      {
        alternatives: exactLive.slice(0, 2).map(publicMatch),
        reason: "ambiguous",
      },
      live,
      drafts
    );
  }

  const exactDraft = exactHits(drafts, trimmed);
  if (exactDraft.length >= 1) {
    return withLists(
      { match: publicMatch(exactDraft[0]), reason: "not_published" },
      live,
      drafts
    );
  }

  const simPick = pickLiveBySimilarity(live);
  if (simPick) return withLists(simPick, live, drafts);

  const firstLive = firstWordHits(live, trimmed);
  if (firstLive.length === 1) {
    return withLists(
      { match: publicMatch(firstLive[0]), reason: "matched" },
      live,
      drafts
    );
  }
  if (firstLive.length >= 2) {
    return withLists(
      {
        alternatives: rankedBySim(firstLive).slice(0, 2).map(publicMatch),
        reason: "ambiguous",
      },
      live,
      drafts
    );
  }

  const draftSim = rankedBySim(
    drafts.filter((row) => Number(row.sim) >= SIM_THRESHOLD)
  );
  if (draftSim.length >= 2 && Number(draftSim[0].sim) - Number(draftSim[1].sim) <= AMBIGUOUS_DELTA) {
    return withLists(
      {
        alternatives: draftSim.slice(0, 2).map(publicMatch),
        reason: "not_published",
      },
      live,
      drafts
    );
  }
  if (draftSim.length >= 1) {
    return withLists(
      { match: publicMatch(draftSim[0]), reason: "not_published" },
      live,
      drafts
    );
  }

  const firstDraft = firstWordHits(drafts, trimmed);
  if (firstDraft.length === 1) {
    return withLists(
      { match: publicMatch(firstDraft[0]), reason: "not_published" },
      live,
      drafts
    );
  }
  if (firstDraft.length >= 2) {
    return withLists(
      {
        alternatives: rankedBySim(firstDraft).slice(0, 2).map(publicMatch),
        reason: "not_published",
      },
      live,
      drafts
    );
  }

  return withLists({ reason: "not_found" }, live, drafts);
}

export function isResolvedMatch(resolved) {
  return resolved?.reason === "matched" && resolved?.match?.status === "live" && resolved.match.id;
}

export function formatPublishedAgo(iso, now = new Date()) {
  if (!iso) return "unpublished";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "unpublished";
  const minutes = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

export function buildScriptBatchConfirm({ resolved, count, sourceFilter }) {
  const leadCount = Math.max(
    1,
    Math.min(Number(count) || 0, CONFIRM_COUNT_CAP)
  );
  const sourceLabel = String(sourceFilter || "").trim() || "the cold list";
  return formatScriptBatchConfirm({
    displayName: resolved.match.display_name,
    version: resolved.match.current_version,
    publishedAt: resolved.match.published_at,
    leadCount,
    sourceLabel,
  });
}

export function formatScriptBatchConfirm({
  displayName,
  version,
  publishedAt,
  leadCount,
  sourceLabel,
}) {
  const versionLabel = Number(version) > 0 ? `v${version}` : "unpublished";
  const ago = formatPublishedAgo(publishedAt);
  const from = sourceLabel ? ` from ${sourceLabel}` : "";
  const aed = estimateBatchAed(leadCount);
  const cost = aed < 1 ? "less than 1 AED" : `${Math.round(aed)} AED`;
  return `Using *${displayName}* (${versionLabel}, published ${ago}) for ${leadCount} leads${from}. Roughly ${cost} (estimate). Go?`;
}

export function resolveFailurePayload(resolved) {
  const liveNames = resolved?.liveNames || [];
  const unpublishedNames = resolved?.unpublishedNames || [];
  const alternatives = (resolved?.alternatives || []).map((row) => row.display_name);
  const named = resolved?.match?.display_name || null;
  let instruction = "Do not start a batch. Never fall back to a default script.";
  if (resolved?.reason === "ambiguous") {
    instruction = `Ambiguous script name. Offer these two and ask which: ${alternatives.join(" vs ")}. Do not start a batch. Never fall back to a default script.`;
  } else if (resolved?.reason === "not_published") {
    const label = named || alternatives.join(" / ") || "That script";
    instruction = `${label} is not published. Say so. Live scripts: ${liveNames.join(", ") || "(none published)"}. Do not start a batch. Never fall back to a default script.`;
  } else {
    instruction = `No matching published script. Live scripts: ${liveNames.join(", ") || "(none published)"}${unpublishedNames.length ? `. Drafts (not published): ${unpublishedNames.join(", ")}` : ""}. Ask which to use. Do not start a batch. Never fall back to a default script.`;
  }
  return {
    ok: false,
    reason: resolved?.reason || "not_found",
    match: resolved?.match || null,
    alternatives: resolved?.alternatives || [],
    liveNames,
    unpublishedNames,
    instruction,
  };
}

export async function listScripts(tenantId) {
  const { data, error } = await db().rpc("script_resolve_candidates", {
    p_tenant_id: tenantId,
    p_phrase: "",
  });
  if (error) throw new Error(`List scripts failed: ${error.message}`);
  const scripts = (data || [])
    .slice()
    .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)))
    .map((row) => ({
      display_name: row.display_name,
      status: row.status,
      current_version: Number(row.current_version) || 0,
      published_at: row.published_at || null,
    }));
  const live = scripts.filter((row) => row.status === "live").map((row) => row.display_name);
  const drafts = scripts
    .filter((row) => row.status !== "live")
    .map((row) => row.display_name);
  const instruction = live.length
    ? `LIVE (may dial): ${live.join(", ")}. DRAFT (cannot dial): ${drafts.join(", ") || "none"}. Never say all scripts are draft when LIVE is non-empty.`
    : `No published scripts. Drafts only: ${drafts.join(", ") || "none"}. Do not start a batch.`;
  return { live, drafts, instruction };
}

/** Named-list / chat batches must pick a published script — never silent default. */
export async function scriptRequiredPayload(tenantId, { source } = {}) {
  const listed = await listScripts(tenantId);
  const sourceLabel = String(source || "").trim();
  let instruction = listed.instruction;
  if (listed.live.length === 1) {
    instruction = sourceLabel
      ? `A live script is required. Ask: Use ${listed.live[0]} on ${sourceLabel}? Do not say scripts are unpublished. Do not start a batch.`
      : `A live script is required. Ask: Use ${listed.live[0]}? Do not say scripts are unpublished. Do not start a batch.`;
  } else if (listed.live.length > 1) {
    instruction = `A live script is required. Ask which: ${listed.live.join(", ")}. Do not say scripts are unpublished. Do not start a batch.`;
  }
  return {
    ok: false,
    reason: "script_required",
    liveNames: listed.live,
    unpublishedNames: listed.drafts,
    source: sourceLabel || null,
    instruction,
  };
}
