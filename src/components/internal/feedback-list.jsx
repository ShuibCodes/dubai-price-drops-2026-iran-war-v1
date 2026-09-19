"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { Strip } from "@/components/ui/strip";
import {
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TYPES,
  FEEDBACK_TYPE_LABELS,
} from "@/lib/feedback/constants";
import { formatWhen, statusLabel, statusTone, typeLabel } from "@/lib/feedback/display";
import { internalJson } from "@/lib/internal/client";

export function InternalFeedbackList() {
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState("");
  const [tenant, setTenant] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [tenants, setTenants] = useState([]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (tenant) params.set("tenant", tenant);
    if (type) params.set("type", type);
    if (status) params.set("status", status);
    const qs = params.toString();
    return qs ? `/api/internal/feedback?${qs}` : "/api/internal/feedback";
  }, [tenant, type, status]);

  const load = useCallback(async () => {
    const body = await internalJson(query, { fallback: "Could not load tickets." });
    const rows = body.tickets || [];
    setTickets(rows);
    if (!tenant && !type && !status) {
      const seen = new Map();
      for (const row of rows) {
        if (row.tenant_id && !seen.has(row.tenant_id)) {
          seen.set(row.tenant_id, {
            id: row.tenant_id,
            slug: row.tenant_slug,
            name: row.tenant_name,
          });
        }
      }
      setTenants([...seen.values()]);
    }
  }, [query, tenant, type, status]);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  return (
    <main className="az-shell min-h-screen font-sans">
      <div className="border-b border-line">
        <div className="mx-auto flex max-w-[1040px] items-center justify-between px-6 py-3.5">
          <span className="font-mono text-[13px] font-bold tracking-[.14em] text-fg">
            AGENTZERO · FEEDBACK
          </span>
        </div>
      </div>
      <div className="mx-auto max-w-[1040px] px-6 pb-28 pt-12">
        <h1 className="az-h1 mb-3 text-fg">Tickets</h1>
        <p className="mb-8 text-[16px] text-dim">
          Cross-tenant inbox. Clients never see this screen.
        </p>

        {error ? (
          <Strip className="mb-6" tone="markup">
            <span>{error}</span>
          </Strip>
        ) : null}

        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="filter-tenant">Tenant</Label>
            <Field
              as="select"
              id="filter-tenant"
              onChange={(event) => setTenant(event.target.value)}
              value={tenant}
            >
              <option value="">All tenants</option>
              {tenants.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.slug || row.name || row.id}
                </option>
              ))}
            </Field>
          </div>
          <div>
            <Label htmlFor="filter-type">Type</Label>
            <Field
              as="select"
              id="filter-type"
              onChange={(event) => setType(event.target.value)}
              value={type}
            >
              <option value="">All types</option>
              {FEEDBACK_TYPES.map((value) => (
                <option key={value} value={value}>
                  {FEEDBACK_TYPE_LABELS[value]}
                </option>
              ))}
            </Field>
          </div>
          <div>
            <Label htmlFor="filter-status">Status</Label>
            <Field
              as="select"
              id="filter-status"
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              <option value="">All statuses</option>
              {FEEDBACK_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {FEEDBACK_STATUS_LABELS[value]}
                </option>
              ))}
            </Field>
          </div>
        </div>

        <div className="border-t border-line">
          {tickets == null ? (
            <>
              <div className="az-row h-[86px]" />
              <div className="az-row h-[86px]" />
            </>
          ) : tickets.length === 0 ? (
            <p className="py-8 text-[15px] text-dim">No tickets match those filters.</p>
          ) : (
            tickets.map((ticket) => (
              <Link
                className="az-row hover:bg-panel"
                href={`/internal/feedback/${ticket.id}`}
                key={ticket.id}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[17px] font-medium text-fg">
                    {ticket.title}
                  </div>
                  <div className="mt-1 font-mono text-[11px] tracking-[.08em] text-dim">
                    {ticket.tenant_slug || "tenant"} · {typeLabel(ticket.type)} ·{" "}
                    {formatWhen(ticket.updated_at)}
                  </div>
                </div>
                <Pill tone={statusTone(ticket.status)}>
                  {statusLabel(ticket.status)}
                </Pill>
              </Link>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
