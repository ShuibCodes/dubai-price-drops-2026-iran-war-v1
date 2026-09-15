import { consoleContext, jsonError } from "@/lib/console/http";
import { routeId } from "@/lib/scripts/http";
import {
  fetchRecordingMedia,
  recordingAccess,
  resolveCallRecording,
} from "@/lib/vapi/recording";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request, { params }) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;
    const id = await routeId(params);
    if (!id) return jsonError("Call not found.", 404);

    const { data: call, error } = await supabase
      .from("calls")
      .select("id, tenant_id, vapi_call_id")
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const access = recordingAccess(session, call);
    if (!access.ok) {
      return jsonError(access.error, access.status);
    }

    const resolved = await resolveCallRecording(call);
    if (!resolved.ok) {
      return jsonError(resolved.error, resolved.status);
    }

    const range = request.headers.get("range");
    const media = await fetchRecordingMedia(resolved.recordingUrl, { range });
    if (!media.ok) {
      return jsonError(media.error, media.status);
    }

    return new Response(media.body, {
      status: media.status,
      headers: media.headers,
    });
  } catch (error) {
    return jsonError("Recording unavailable.", error.status || 502);
  }
}
