import {
  deleteGoogleCalendarEvent,
  refreshGoogleAccessToken,
} from "./google.js";
import { decryptCalendarTokens } from "./tokens.js";

export const MAX_ORPHAN_RETRIES = 5;
export const ORPHAN_RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 240];

const TOKEN_LEAK = /access_token|refresh_token|token_ciphertext|"token":|ya29\.|1\/\//gi;

export async function getValidAccessTokenForConnection(connection, google) {
  const tokens = decryptCalendarTokens(connection.token_ciphertext);
  const expiresAt = tokens.expires_at ? Date.parse(tokens.expires_at) : 0;
  if (
    tokens.access_token &&
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now() + 60_000
  ) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) {
    throw new Error("No refresh_token available — connection may be revoked");
  }
  const refreshFn = google?.refreshAccessToken || refreshGoogleAccessToken;
  const refreshed = await refreshFn(tokens.refresh_token);
  return refreshed.access_token;
}

/**
 * Process a single orphan failure row.
 */
export async function processSingleOrphanFailure(
  row,
  {
    supabase,
    google,
    dryRun = false,
    maxRetries = MAX_ORPHAN_RETRIES,
    backoffMinutes = ORPHAN_RETRY_BACKOFF_MINUTES,
  }
) {
  const label = `[orphan ${row.id}] event=${row.provider_event_id} agent=${row.agent_id}`;

  if (row.retry_count >= maxRetries) {
    if (!dryRun && supabase) {
      await supabase
        .from("calendar_compensation_failures")
        .update({ status: "abandoned", last_retry_at: new Date().toISOString() })
        .eq("id", row.id);
    }
    return { status: "abandoned", id: row.id };
  }

  if (row.last_retry_at) {
    const backoffMin =
      backoffMinutes[Math.min(row.retry_count, backoffMinutes.length - 1)];
    const nextRetryAfter = new Date(
      Date.parse(row.last_retry_at) + backoffMin * 60_000
    );
    if (new Date() < nextRetryAfter) {
      return { status: "skipped", id: row.id, reason: "backoff_active" };
    }
  }

  if (!row.provider_event_id) {
    if (!dryRun && supabase) {
      await supabase
        .from("calendar_compensation_failures")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", row.id);
    }
    return { status: "resolved", id: row.id };
  }

  if (!row.calendar_connection_id) {
    if (!dryRun && supabase) {
      await supabase
        .from("calendar_compensation_failures")
        .update({
          status: "abandoned",
          reason: String(`${row.reason || ""} | no calendar_connection_id`).slice(0, 240),
          last_retry_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
    return { status: "abandoned", id: row.id, reason: "missing_connection_id" };
  }

  const { data: connection, error: connError } = await supabase
    .from("calendar_connections")
    .select("id, tenant_id, agent_id, calendar_id, token_ciphertext, token_expires_at, status")
    .eq("id", row.calendar_connection_id)
    .maybeSingle();

  if (connError || !connection || !connection.token_ciphertext) {
    if (!dryRun && supabase) {
      await supabase
        .from("calendar_compensation_failures")
        .update({
          status: "abandoned",
          reason: String(`${row.reason || ""} | connection_unavailable`).slice(0, 240),
          last_retry_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
    return { status: "abandoned", id: row.id, reason: "connection_unavailable" };
  }

  if (dryRun) {
    return { status: "dry_run", id: row.id };
  }

  const newRetryCount = (row.retry_count || 0) + 1;
  const nowIso = new Date().toISOString();

  await supabase
    .from("calendar_compensation_failures")
    .update({
      status: "retrying",
      retry_count: newRetryCount,
      last_retry_at: nowIso,
    })
    .eq("id", row.id);

  try {
    const accessToken = await getValidAccessTokenForConnection(connection, google);
    const deleteFn = google?.deleteEvent || deleteGoogleCalendarEvent;
    const result = await deleteFn({
      accessToken,
      calendarId: row.calendar_id || connection.calendar_id || "primary",
      eventId: row.provider_event_id,
    });

    await supabase
      .from("calendar_compensation_failures")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    return {
      status: "resolved",
      id: row.id,
      deleted: result?.deleted ?? true,
      alreadyGone: result?.alreadyGone ?? false,
    };
  } catch (err) {
    const safeError = String(err.message || "delete_failed")
      .replace(TOKEN_LEAK, "[redacted]")
      .slice(0, 180);

    const isAbandoned = newRetryCount >= maxRetries;
    await supabase
      .from("calendar_compensation_failures")
      .update({
        status: isAbandoned ? "abandoned" : "pending",
        reason: String(`${row.reason || ""} | retry_${newRetryCount}: ${safeError}`).slice(0, 240),
        last_retry_at: nowIso,
      })
      .eq("id", row.id);

    return { status: "retry_failed", id: row.id, error: safeError };
  }
}

/**
 * Main batch processor for orphan calendar events.
 */
export async function processCalendarOrphanEvents({
  supabase,
  google,
  limit = 50,
  dryRun = false,
  maxRetries = MAX_ORPHAN_RETRIES,
} = {}) {
  if (!supabase) throw new Error("Supabase client is required");

  const { data: orphans, error } = await supabase
    .from("calendar_compensation_failures")
    .select("*")
    .in("status", ["pending", "retrying"])
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to query calendar compensation failures: ${error.message}`);
  }

  const summary = {
    total: orphans?.length || 0,
    resolved: 0,
    abandoned: 0,
    skipped: 0,
    retry_failed: 0,
    dry_run: 0,
  };

  if (!orphans || orphans.length === 0) {
    return summary;
  }

  for (const orphan of orphans) {
    try {
      const outcome = await processSingleOrphanFailure(orphan, {
        supabase,
        google,
        dryRun,
        maxRetries,
      });
      if (summary[outcome.status] !== undefined) {
        summary[outcome.status] += 1;
      }
    } catch (err) {
      summary.retry_failed += 1;
    }
  }

  return summary;
}

