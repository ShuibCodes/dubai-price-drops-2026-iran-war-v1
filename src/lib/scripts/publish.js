import { composePrompt, PREAMBLE_VERSION } from "@/lib/scripts/compose";
import { parseScriptConfig } from "@/lib/scripts/schema";
import { upsertVapiAssistant } from "@/lib/vapi/dial";
import { jsonError, migratedWriteBlocked } from "./http";

function assistantName(tenant, script) {
  const slug = String(tenant?.slug || "").trim() || "tenant";
  const name = String(script?.display_name || "").trim() || "untitled";
  return `${slug} — ${name}`;
}

const VERSION_COLS =
  "id, script_id, version_no, config_json, published_at, published_by, created_at";

function versionsForTenant(supabase, scriptId, tenantId) {
  return supabase
    .from("script_versions")
    .select(`${VERSION_COLS}, scripts!inner(tenant_id)`)
    .eq("script_id", scriptId)
    .eq("scripts.tenant_id", tenantId);
}

export async function maxVersionNo(supabase, scriptId, tenantId) {
  const { data, error } = await versionsForTenant(supabase, scriptId, tenantId)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Version lookup failed: ${error.message}`);
  return Number(data?.version_no || 0);
}

export async function loadVersionByNo(supabase, scriptId, versionNo, tenantId) {
  const { data, error } = await versionsForTenant(supabase, scriptId, tenantId)
    .eq("version_no", versionNo)
    .maybeSingle();
  if (error) throw new Error(`Version lookup failed: ${error.message}`);
  return data || null;
}

export async function loadLatestVersion(supabase, scriptId, tenantId) {
  const { data, error } = await versionsForTenant(supabase, scriptId, tenantId)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Version lookup failed: ${error.message}`);
  return data || null;
}

/**
 * Unpublished row at current_version + 1, if any.
 * PATCH writes here. Publish stamps this row rather than inserting a duplicate.
 */
export async function loadDraftVersion(supabase, script, tenantId) {
  const versionNo = Number(script.current_version) + 1;
  const row = await loadVersionByNo(supabase, script.id, versionNo, tenantId);
  if (!row || row.published_at) return null;
  return row;
}

export async function insertVersionRow(supabase, { scriptId, versionNo, config, prompt }) {
  const { data, error } = await supabase
    .from("script_versions")
    .insert({
      script_id: scriptId,
      version_no: versionNo,
      config_json: config,
      composed_prompt: prompt,
      preamble_version: PREAMBLE_VERSION,
      published_at: null,
      published_by: null,
    })
    .select(
      "id, script_id, version_no, config_json, published_at, published_by, created_at"
    )
    .single();
  if (error) throw new Error(`Version insert failed: ${error.message}`);
  return data;
}

export async function upsertDraftVersion({
  supabase,
  script,
  tenant,
  config,
}) {
  const parsed = parseScriptConfig(config);
  if (!parsed.ok) {
    return { response: jsonError("Invalid script config.", 400, { fieldErrors: parsed.fieldErrors }) };
  }

  const prompt = composePrompt({
    config: parsed.data,
    tenant,
    script,
  });
  const versionNo = Number(script.current_version) + 1;
  const existing = await loadVersionByNo(
    supabase,
    script.id,
    versionNo,
    script.tenant_id
  );

  if (existing && !existing.published_at) {
    const { data, error } = await supabase
      .from("script_versions")
      .update({
        config_json: parsed.data,
        composed_prompt: prompt,
        preamble_version: PREAMBLE_VERSION,
      })
      .eq("id", existing.id)
      .eq("script_id", script.id)
      .is("published_at", null)
      .select(
        "id, script_id, version_no, config_json, published_at, published_by, created_at"
      )
      .single();
    if (error) throw new Error(`Draft save failed: ${error.message}`);
    return { version: data, config: parsed.data };
  }

  if (existing?.published_at) {
    return { response: jsonError("This version is already published. Save a new draft.", 409) };
  }

  const version = await insertVersionRow(supabase, {
    scriptId: script.id,
    versionNo,
    config: parsed.data,
    prompt,
  });
  return { version, config: parsed.data };
}

/**
 * Publish order from the brief:
 * validate → insert unpublished version (or reuse PATCH draft at current+1) →
 * upsertVapiAssistant → one SQL transaction for published_at / live pointer.
 */
export async function publishVersion({
  supabase,
  session,
  script,
  tenant,
  version,
}) {
  const migratedBlock = migratedWriteBlocked(script);
  if (migratedBlock) return { response: migratedBlock };

  const parsed = parseScriptConfig(version.config_json);
  if (!parsed.ok) {
    return { response: jsonError("Invalid script config.", 400, { fieldErrors: parsed.fieldErrors }) };
  }

  const prompt = composePrompt({
    config: parsed.data,
    tenant,
    script,
  });

  const { error: composeError } = await supabase
    .from("script_versions")
    .update({
      config_json: parsed.data,
      composed_prompt: prompt,
      preamble_version: PREAMBLE_VERSION,
    })
    .eq("id", version.id)
    .eq("script_id", script.id)
    .is("published_at", null);
  if (composeError) {
    throw new Error(`Version compose save failed: ${composeError.message}`);
  }

  let vapiAssistantId;
  try {
    vapiAssistantId = await upsertVapiAssistant({
      vapiAssistantId: script.vapi_assistant_id,
      name: assistantName(tenant, script),
      prompt,
      voiceId: parsed.data.voice_id,
    });
  } catch (error) {
    console.error("[scripts/publish] vapi upsert failed", {
      script_id: script.id,
      version_no: version.version_no,
      agent_id: session.agentId,
      message: error.message,
    });
    return {
      response: jsonError(
        error.message || "Voice assistant update failed. Live script unchanged.",
        502
      ),
    };
  }

  const { data: publishedAt, error: rpcError } = await supabase.rpc(
    "publish_script_version",
    {
      p_tenant_id: session.tenantId,
      p_script_id: script.id,
      p_version_id: version.id,
      p_agent_id: session.agentId,
      p_vapi_assistant_id: vapiAssistantId,
      p_version_no: version.version_no,
    }
  );
  if (rpcError) {
    throw new Error(`Publish transaction failed: ${rpcError.message}`);
  }

  console.info("[scripts/publish]", {
    script_id: script.id,
    version_no: version.version_no,
    agent_id: session.agentId,
    PREAMBLE_VERSION,
  });

  return {
    result: {
      version_no: version.version_no,
      published_at: publishedAt,
      vapi_assistant_id: vapiAssistantId,
    },
  };
}
