const EMPTY_COUNTS = {
  queued: 0,
  dialed: 0,
  completed: 0,
  failed: 0,
  qualified: 0,
};

export function mergeCounts(raw) {
  const counts = { ...EMPTY_COUNTS };
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(EMPTY_COUNTS)) {
      const n = Number(raw[key]);
      if (Number.isFinite(n) && n >= 0) counts[key] = n;
    }
  }
  return counts;
}

export async function createCallBatch(supabase, {
  tenantId,
  agentId,
  scriptId,
  scriptVersionId,
  sourceType,
  filter = {},
  windowStart,
  windowEnd,
  estCostAed,
  queued = 0,
}) {
  const { data, error } = await supabase
    .from("call_batches")
    .insert({
      tenant_id: tenantId,
      agent_id: agentId || null,
      script_id: scriptId || null,
      script_version_id: scriptVersionId || null,
      source_type: String(sourceType || "console-run"),
      filter,
      window_start: windowStart || null,
      window_end: windowEnd || null,
      status: "queued",
      est_cost_aed: estCostAed ?? null,
      counts: { ...EMPTY_COUNTS, queued },
    })
    .select("*")
    .single();
  if (error) throw new Error(`Batch create failed: ${error.message}`);
  return data;
}

export async function bumpBatchCount(supabase, batchId, field, { status } = {}) {
  if (!batchId || !field) return;
  const { data, error } = await supabase
    .from("call_batches")
    .select("id, counts, status")
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw new Error(`Batch lookup failed: ${error.message}`);
  if (!data) return;

  const counts = mergeCounts(data.counts);
  counts[field] = (counts[field] || 0) + 1;

  let nextStatus = status || data.status;
  if (!status) {
    if (field === "dialed" && data.status === "queued") nextStatus = "running";
    const remaining =
      (counts.queued || 0) - (counts.dialed || 0) - (counts.failed || 0);
    if (remaining <= 0 && (counts.dialed || 0) + (counts.failed || 0) > 0) {
      nextStatus = counts.failed > 0 && counts.dialed < 1 ? "failed" : "complete";
    }
  }

  const { error: updateError } = await supabase
    .from("call_batches")
    .update({ counts, status: nextStatus })
    .eq("id", batchId);
  if (updateError) throw new Error(`Batch update failed: ${updateError.message}`);
}

export async function refreshBatchStatus(supabase, batchId) {
  if (!batchId) return;
  const { count: remaining, error } = await supabase
    .from("call_queue")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .eq("processed", false);
  if (error) throw new Error(`Batch remaining query failed: ${error.message}`);
  if ((remaining || 0) > 0) return;

  const { data } = await supabase
    .from("call_batches")
    .select("status")
    .eq("id", batchId)
    .maybeSingle();
  if (!data || data.status === "complete" || data.status === "cancelled") return;

  const { error: updateError } = await supabase
    .from("call_batches")
    .update({ status: "complete" })
    .eq("id", batchId)
    .in("status", ["queued", "running"]);
  if (updateError) throw new Error(`Batch complete failed: ${updateError.message}`);
}
