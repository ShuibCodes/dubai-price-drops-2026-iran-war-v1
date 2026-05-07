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
 * @param {string} originalFilename
 */
function sanitizeBasenameStem(originalFilename) {
  const base = path.basename(String(originalFilename).replace(/\\/g, "/"));
  const stem = base.replace(/\.txt$/i, "") || "export";
  let slug = stem
    .normalize("NFKC")
    .replace(/[^\w\-.]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 96)
    .toLowerCase();
  if (!slug) slug = "export";
  return slug;
}

/**
 * @param {string} stem
 * @param {string} agentSlug
 * @param {number} stamp
 * @param {number} index
 */
function makeSavedFilename(stem, agentSlug, stamp, index) {
  const prefix = agentSlug ? `${agentSlug}_` : "";
  return `${prefix}${stem}_${stamp}_${index}.txt`;
}

export async function POST(request) {
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
  const agentSlug = agentId ? sanitizeAgentSlug(agentId) : "";

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

  const stamp = Date.now();

  /** @type {{ originalName: string, savedAs: string, messageCount: number, participants: string[] }[]} */
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

      const stem = sanitizeBasenameStem(originalName);
      const slugForPrefix = agentId ? agentSlug : "";
      const savedAs = makeSavedFilename(stem, slugForPrefix, stamp, index);
      const absPath = path.join(targetDir, savedAs);

      await fs.writeFile(absPath, text, "utf-8");

      fileResults.push({
        originalName,
        savedAs,
        messageCount: meta.messageCount,
        participants: meta.participants,
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
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown rebuild failure.";
    return NextResponse.json(
      {
        success: false,
        error: `Files were saved but the KB index could not be rebuilt. ${message}`,
        filesUploaded: fileResults.length,
        files: fileResults,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    filesUploaded: fileResults.length,
    docsAdded: fileResults.length,
    files: fileResults,
  });
}
