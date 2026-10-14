/** Client-safe recording UI helpers. No Vapi credentials or fetches. */

export function isHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** True when the webhook stored a real media URL (busy/no-answer rows usually have none). */
export function callHasPlayableRecording(call) {
  return isHttpUrl(call?.recording_url) && Boolean(String(call?.vapi_call_id || "").trim());
}

export function recordingPlayback(call) {
  const playable =
    call?.has_recording === true || callHasPlayableRecording(call);
  if (playable && call?.id) {
    return {
      kind: "play",
      href: `/api/console/calls/${encodeURIComponent(call.id)}/recording`,
    };
  }
  if (call?.status === "queued") return { kind: "none" };
  return { kind: "missing" };
}
