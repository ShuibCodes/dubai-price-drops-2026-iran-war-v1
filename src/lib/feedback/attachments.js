import {
  ALLOWED_IMAGE_TYPES,
  ATTACHMENT_BUCKET,
  MAX_IMAGE_BYTES,
} from "@/lib/feedback/constants";
import { FeedbackError } from "@/lib/feedback/access";

const UNSAFE_NAME = /[\\/]/g;

export function sanitizeFilename(name) {
  const base = String(name || "image")
    .replace(UNSAFE_NAME, "")
    .replace(/\s+/g, "-")
    .slice(0, 180);
  return base || "image";
}

export function sniffImageType(filename, contentType) {
  const type = String(contentType || "").toLowerCase().split(";")[0].trim();
  if (ALLOWED_IMAGE_TYPES.has(type)) return type;
  const ext = String(filename || "").toLowerCase().split(".").pop();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return null;
}

export function validateImageFile({ filename, contentType, bytes }) {
  const type = sniffImageType(filename, contentType);
  if (!type) {
    throw new FeedbackError("Images only: JPEG, PNG, or WebP.", 400);
  }
  const size = Number(bytes) || 0;
  if (size < 1) {
    throw new FeedbackError("Attachment is empty.", 400);
  }
  if (size > MAX_IMAGE_BYTES) {
    throw new FeedbackError("Image must be 5 MB or smaller.", 400);
  }
  return {
    filename: sanitizeFilename(filename),
    contentType: type,
    bytes: size,
  };
}

export function attachmentStoragePath({ tenantId, agentId, id, filename }) {
  const safeAgent = String(agentId || "staff").replace(UNSAFE_NAME, "");
  return `${tenantId}/${safeAgent}/${id}-${sanitizeFilename(filename)}`;
}

export async function uploadFeedbackImage(supabase, { storagePath, buffer, contentType }) {
  const { error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(storagePath, buffer, {
      contentType,
      upsert: false,
    });
  if (error) {
    throw new FeedbackError(`Upload failed: ${error.message}`, 502);
  }
}

export async function downloadFeedbackImage(supabase, storagePath) {
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .download(storagePath);
  if (error || !data) {
    throw new FeedbackError("Attachment not found.", 404);
  }
  return data;
}
