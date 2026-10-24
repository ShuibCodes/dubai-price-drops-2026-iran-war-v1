import { consoleContext, jsonError } from "@/lib/console/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT = 600;

export async function POST(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return jsonError("ELEVENLABS_API_KEY is not set.", 500);

    const body = await request.json().catch(() => ({}));
    const voiceId = String(body.voiceId || "").trim();
    const text = String(body.text || "").trim();
    if (!/^[A-Za-z0-9]{10,40}$/.test(voiceId)) {
      return jsonError("That does not look like an ElevenLabs voice ID.", 400);
    }
    if (!text) return jsonError("Type something for the voice to say.", 400);
    if (text.length > MAX_TEXT) {
      return jsonError(`Keep it under ${MAX_TEXT} characters.`, 400);
    }

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
        }),
      }
    );

    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      const message =
        detail?.detail?.message ||
        (typeof detail?.detail === "string" ? detail.detail : "") ||
        `ElevenLabs returned ${res.status}.`;
      return jsonError(message, res.status === 401 ? 502 : res.status);
    }

    return new Response(res.body, {
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}
