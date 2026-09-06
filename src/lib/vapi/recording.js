/**
 * Server-side Vapi recording retrieval.
 * Uses the same /call collection as getLatestTargetLeadCallSummary
 * (`VAPI_CALLS_PATH`, default `/call`) plus the call id already stored on
 * `calls.vapi_call_id`. Recording field names match the webhook extractor.
 *
 * Stored `calls.recording_url` is never used as a playback source: it is the
 * short-lived URL that made the old Play button dead.
 */

import { isHttpUrl } from "@/lib/console/recording-playback";

export {
  callHasPlayableRecording,
  isHttpUrl,
  recordingPlayback,
} from "@/lib/console/recording-playback";

const FORWARD_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
];

export function extractVapiRecordingUrl(payload) {
  if (!payload || typeof payload !== "object") return "";
  const candidates = [
    payload.recordingUrl,
    payload.stereoRecordingUrl,
    payload.call?.recordingUrl,
    payload.call?.stereoRecordingUrl,
    payload.message?.recordingUrl,
    payload.message?.stereoRecordingUrl,
  ];
  for (const candidate of candidates) {
    if (isHttpUrl(candidate)) return String(candidate).trim();
  }
  return "";
}

export function recordingAccess(session, call) {
  if (!session?.tenantId) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (!call?.id) {
    return { ok: false, status: 404, error: "Call not found." };
  }
  if (String(call.tenant_id) !== String(session.tenantId)) {
    return { ok: false, status: 404, error: "Call not found." };
  }
  return { ok: true };
}

function vapiCallsBase() {
  const baseUrl = String(process.env.VAPI_BASE_URL || "https://api.vapi.ai").replace(
    /\/$/,
    ""
  );
  const callsPath = String(process.env.VAPI_CALLS_PATH || "/call").trim() || "/call";
  const path = callsPath.startsWith("/") ? callsPath : `/${callsPath}`;
  return `${baseUrl}${path.replace(/\/$/, "")}`;
}

export async function fetchVapiCallRecord(
  vapiCallId,
  { fetchImpl = fetch, apiKey = process.env.VAPI_API_KEY } = {}
) {
  const id = String(vapiCallId || "").trim();
  if (!id) {
    return { ok: false, status: 404, error: "Recording not found." };
  }
  if (!apiKey) {
    return { ok: false, status: 502, error: "Recording unavailable." };
  }

  let response;
  try {
    response = await fetchImpl(`${vapiCallsBase()}/${encodeURIComponent(id)}`, {
      method: "GET",
      redirect: "manual",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    return { ok: false, status: 502, error: "Recording unavailable." };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, status: 502, error: "Recording unavailable." };
  }
  if (response.status === 404) {
    return { ok: false, status: 404, error: "Recording not found." };
  }
  if (!response.ok) {
    return { ok: false, status: 502, error: "Recording unavailable." };
  }

  const payload = await response.json().catch(() => null);
  const recordingUrl = extractVapiRecordingUrl(payload);
  if (!recordingUrl) {
    return { ok: false, status: 404, error: "Recording not found." };
  }
  return { ok: true, recordingUrl };
}

const HEADER_NAMES = {
  "content-type": "Content-Type",
  "content-length": "Content-Length",
  "content-range": "Content-Range",
  "accept-ranges": "Accept-Ranges",
};

function pickForwardHeaders(headers) {
  const out = { "Cache-Control": "private, no-store" };
  if (!headers) {
    out["Content-Type"] = "audio/mpeg";
    return out;
  }
  for (const name of FORWARD_HEADERS) {
    const value = headers.get(name);
    if (value) out[HEADER_NAMES[name]] = value;
  }
  if (!out["Content-Type"]) out["Content-Type"] = "audio/mpeg";
  return out;
}

export async function fetchRecordingMedia(
  recordingUrl,
  { fetchImpl = fetch, range } = {}
) {
  if (!isHttpUrl(recordingUrl)) {
    return { ok: false, status: 404, error: "Recording not found." };
  }

  const headers = {};
  if (range) headers.Range = range;

  let response;
  try {
    response = await fetchImpl(recordingUrl, { headers });
  } catch {
    return { ok: false, status: 502, error: "Recording unavailable." };
  }

  if (response.status === 404 || response.status === 410) {
    return { ok: false, status: 404, error: "Recording not found." };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, status: 502, error: "Recording unavailable." };
  }
  if (!response.ok && response.status !== 206) {
    return { ok: false, status: 502, error: "Recording unavailable." };
  }

  return {
    ok: true,
    status: response.status,
    headers: pickForwardHeaders(response.headers),
    body: response.body,
  };
}

export async function resolveCallRecording(
  call,
  { fetchImpl = fetch, apiKey = process.env.VAPI_API_KEY } = {}
) {
  if (!String(call?.vapi_call_id || "").trim()) {
    return { ok: false, status: 404, error: "Recording not found." };
  }
  return fetchVapiCallRecord(call.vapi_call_id, { fetchImpl, apiKey });
}
