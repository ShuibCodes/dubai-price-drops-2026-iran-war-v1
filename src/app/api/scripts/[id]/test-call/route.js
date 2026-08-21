import { composePrompt } from "@/lib/scripts/compose";
import {
  jsonError,
  loadTenant,
  loadTenantScript,
  routeId,
  SCRIPT_TEST_SOURCE,
  scriptsContext,
} from "@/lib/scripts/http";
import { loadLatestVersion, loadVersionByNo } from "@/lib/scripts/publish";
import { parseScriptConfig } from "@/lib/scripts/schema";
import { startLeadCall, startWebCall, VAPI_ASSISTANT_LOCK } from "@/lib/vapi/dial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const ctx = await scriptsContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    const body = await request.json().catch(() => ({}));
    const mode = body.mode === "web" ? "web" : "phone";
    if (body.phone || body.number || body.destination || body.waPhone) {
      return jsonError("Test calls only dial the signed-in agent.", 400);
    }
    if (mode === "phone" && !session.waPhone) {
      return jsonError("No phone on this agent.", 400);
    }

    const loaded = await loadTenantScript(supabase, session, await routeId(params));
    if (loaded.response) return loaded.response;
    const { script } = loaded;
    if (script.is_migrated) {
      return jsonError("Script not found.", 404);
    }
    if (script.status === "archived") {
      return jsonError("Archived scripts cannot be tested.", 409);
    }

    let version;
    if (body.version_no != null && body.version_no !== "") {
      const versionNo = Number(body.version_no);
      if (!Number.isInteger(versionNo) || versionNo < 1) {
        return jsonError("version_no is invalid.", 400);
      }
      version = await loadVersionByNo(
        supabase,
        script.id,
        versionNo,
        session.tenantId
      );
      if (!version) return jsonError("Version not found.", 404);
    } else {
      version = await loadLatestVersion(supabase, script.id, session.tenantId);
      if (!version) return jsonError("Save a draft before placing a test call.", 400);
    }

    const parsed = parseScriptConfig(version.config_json);
    if (!parsed.ok) {
      return jsonError("Invalid script config.", 400, { fieldErrors: parsed.fieldErrors });
    }

    const tenantLoaded = await loadTenant(supabase, session.tenantId);
    if (tenantLoaded.response) return tenantLoaded.response;
    const { tenant } = tenantLoaded;

    const prompt = composePrompt({
      config: parsed.data,
      tenant,
      script,
    });

    const assistantId =
      script.vapi_assistant_id || tenant.vapi_assistant_id || null;

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("name")
      .eq("id", session.agentId)
      .eq("tenant_id", session.tenantId)
      .maybeSingle();
    if (agentError) throw new Error(`Agent lookup failed: ${agentError.message}`);
    const agentName = String(agent?.name || "").trim() || "there";

    const shared = {
      name: agentName,
      assistantId,
      prompt,
      voiceId: parsed.data.voice_id,
      firstMessage: VAPI_ASSISTANT_LOCK.firstMessage,
      variableValues: {
        leadName: agentName,
        agent_name: agentName,
      },
      metadata: {
        tenantId: session.tenantId,
        agentId: session.agentId,
        scriptId: script.id,
        scriptVersionId: version.id,
        source: SCRIPT_TEST_SOURCE,
        testMode: mode,
      },
    };

    let result;
    try {
      result =
        mode === "web"
          ? await startWebCall(shared)
          : await startLeadCall({
              ...shared,
              phone: session.waPhone,
              phoneNumberId: tenant.vapi_phone_number_id,
            });
    } catch (error) {
      return jsonError(error.message || "Test call failed.", 502);
    }

    const { error: insertError } = await supabase.from("calls").insert({
      tenant_id: session.tenantId,
      vapi_call_id: result.callId,
      direction: "outbound",
      status: result.status || "initiated",
      source: SCRIPT_TEST_SOURCE,
      script_id: script.id,
      script_version_id: version.id,
      lead_name: agentName,
      raw: {
        ...(result.raw && typeof result.raw === "object" ? result.raw : {}),
        testCall: {
          agentId: session.agentId,
          versionNo: version.version_no,
          mode,
        },
      },
    });
    if (insertError) {
      console.error("[scripts/test-call] call row insert failed", insertError.message);
    }

    return Response.json({
      callId: result.callId,
      status: result.status,
      version_no: version.version_no,
      mode,
      ...(mode === "web"
        ? {
            webCallUrl: result.webCallUrl,
            ...(result.callToken ? { callToken: result.callToken } : {}),
          }
        : {}),
    });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}
