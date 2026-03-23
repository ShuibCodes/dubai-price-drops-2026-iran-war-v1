import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

const ENDPOINT = "http://127.0.0.1:7865/ingest/e04b9682-c76b-4acd-938a-a9a5c58c5e33";
const SESSION_ID = "6fe137";
const RUN_ID = "pre-repro";
const MAIN_ROOT =
  "/Users/shuibabdillahi/dubai-real-estate/dubai-price-drops-2026-iran-war-v1";

async function sendLog(hypothesisId, location, message, data) {
  await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": SESSION_ID,
    },
    body: JSON.stringify({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
}

async function inspectFile(targetPath) {
  try {
    const stat = await fs.stat(targetPath);
    await fs.access(targetPath, fsConstants.R_OK);
    return {
      exists: true,
      readable: true,
      size: stat.size,
      mode: stat.mode & 0o777,
    };
  } catch (error) {
    return {
      exists: false,
      readable: false,
      errorCode: error?.code ?? "UNKNOWN",
    };
  }
}

async function listSiblingWorktrees(baseDir) {
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const envPath = path.join(baseDir, entry.name, ".env.local");
    const snapshotPath = path.join(
      baseDir,
      entry.name,
      ".data",
      "propertyfinder-dashboard-snapshots.json"
    );
    const companyAccessPath = path.join(
      baseDir,
      entry.name,
      ".data",
      "company-access.json"
    );
    const claudeSettingsPath = path.join(
      baseDir,
      entry.name,
      ".claude",
      "settings.local.json"
    );
    results.push({
      name: entry.name,
      env: await inspectFile(envPath),
      snapshot: await inspectFile(snapshotPath),
      companyAccess: await inspectFile(companyAccessPath),
      claudeSettings: await inspectFile(claudeSettingsPath),
    });
  }

  return results;
}

async function main() {
  const worktreeRoot = process.cwd();
  const worktreeEnv = path.join(worktreeRoot, ".env.local");
  const mainEnv = path.join(MAIN_ROOT, ".env.local");
  const worktreeSnapshot = path.join(
    worktreeRoot,
    ".data",
    "propertyfinder-dashboard-snapshots.json"
  );
  const mainSnapshot = path.join(
    MAIN_ROOT,
    ".data",
    "propertyfinder-dashboard-snapshots.json"
  );
  const worktreeCompanyAccess = path.join(
    worktreeRoot,
    ".data",
    "company-access.json"
  );
  const mainCompanyAccess = path.join(
    MAIN_ROOT,
    ".data",
    "company-access.json"
  );
  const worktreeClaudeSettings = path.join(
    worktreeRoot,
    ".claude",
    "settings.local.json"
  );
  const mainClaudeSettings = path.join(
    MAIN_ROOT,
    ".claude",
    "settings.local.json"
  );
  const gitPointerPath = path.join(worktreeRoot, ".git");
  const siblingBase = path.dirname(worktreeRoot);

  // #region agent log
  await sendLog("H1", ".cursor/debug-worktree-env.mjs:62", "Debug context", {
    worktreeRoot,
    mainRoot: MAIN_ROOT,
    siblingBase,
  });
  // #endregion

  // #region agent log
  await sendLog(
    "H2",
    ".cursor/debug-worktree-env.mjs:70",
    "Worktree env inspection",
    await inspectFile(worktreeEnv)
  );
  // #endregion

  // #region agent log
  await sendLog(
    "H4",
    ".cursor/debug-worktree-env.mjs:79",
    "Main checkout env inspection",
    await inspectFile(mainEnv)
  );
  // #endregion

  // #region agent log
  await sendLog("H5", ".cursor/debug-worktree-env.mjs:88", "Worktree git pointer", {
    gitPointerPath,
    gitPointer: await fs.readFile(gitPointerPath, "utf8"),
  });
  // #endregion

  // #region agent log
  await sendLog(
    "H1",
    ".cursor/debug-worktree-env.mjs:111",
    "Sibling worktree local file presence",
    { worktrees: await listSiblingWorktrees(siblingBase) }
  );
  // #endregion

  // #region agent log
  await sendLog(
    "H2",
    ".cursor/debug-worktree-env.mjs:120",
    "Worktree snapshot inspection",
    await inspectFile(worktreeSnapshot)
  );
  // #endregion

  // #region agent log
  await sendLog(
    "H3",
    ".cursor/debug-worktree-env.mjs:129",
    "Main checkout snapshot inspection",
    await inspectFile(mainSnapshot)
  );
  // #endregion

  // #region agent log
  await sendLog(
    "H6",
    ".cursor/debug-worktree-env.mjs:138",
    "Worktree company-access inspection",
    await inspectFile(worktreeCompanyAccess)
  );
  // #endregion

  // #region agent log
  await sendLog(
    "H6",
    ".cursor/debug-worktree-env.mjs:147",
    "Main checkout company-access inspection",
    await inspectFile(mainCompanyAccess)
  );
  // #endregion

  // #region agent log
  await sendLog(
    "H7",
    ".cursor/debug-worktree-env.mjs:156",
    "Worktree Claude settings inspection",
    await inspectFile(worktreeClaudeSettings)
  );
  // #endregion

  // #region agent log
  await sendLog(
    "H7",
    ".cursor/debug-worktree-env.mjs:165",
    "Main checkout Claude settings inspection",
    await inspectFile(mainClaudeSettings)
  );
  // #endregion
}

await main();
