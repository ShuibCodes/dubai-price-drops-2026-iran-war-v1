"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function gmailConnectedLabel(agent) {
  const email = agent.gmailEmail;
  if (email == null) return "No";
  if (typeof email === "string" && email.trim() === "") return "No";
  return "Yes";
}

function lastSyncLabel(agent) {
  const v = agent.lastGmailSync;
  if (v == null) return "Never";
  if (typeof v === "string" && v.trim() === "") return "Never";
  return String(v);
}

function kbFilesCount(agent) {
  return agent.kbFiles?.length || 0;
}

function newAgentRow(id) {
  return {
    id,
    name: "",
    whatsapp: "",
    role: "agent",
    gmailToken: null,
    gmailEmail: null,
    kbFiles: [],
    lastGmailSync: null,
  };
}

export default function AgentRosterForm({
  onInitialLoadComplete,
  onAgentsChange,
}) {
  const onInitialLoadCompleteRef = useRef(onInitialLoadComplete);
  onInitialLoadCompleteRef.current = onInitialLoadComplete;

  const onAgentsChangeRef = useRef(onAgentsChange);
  onAgentsChangeRef.current = onAgentsChange;

  const [brokerage, setBrokerage] = useState("");
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadRoster = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    setSaveSuccess(false);
    try {
      const res = await fetch("/api/onboard/roster");
      if (!res.ok) throw new Error("Failed to load roster");
      const data = await res.json();
      setBrokerage(typeof data.brokerage === "string" ? data.brokerage : "");
      setAgents(
        Array.isArray(data.agents)
          ? data.agents.map((a) => ({
              ...a,
              role: a.role === "admin" ? "admin" : "agent",
            }))
          : []
      );
    } catch (e) {
      setErrorMessage(e?.message || "Could not load roster.");
      setBrokerage("");
      setAgents([]);
    } finally {
      setLoading(false);
      onInitialLoadCompleteRef.current?.();
    }
  }, []);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  useEffect(() => {
    onAgentsChangeRef.current?.(agents);
  }, [agents]);

  function updateAgent(id, field, value) {
    setSaveSuccess(false);
    setAgents((prev) =>
      prev.map((a) => (a.id === id ? { ...a, [field]: value } : a))
    );
  }

  function addAgent() {
    setAgents((prev) => [...prev, newAgentRow(`agent_${Date.now()}`)]);
    setSaveSuccess(false);
  }

  function removeAgent(id) {
    setAgents((prev) => prev.filter((a) => a.id !== id));
    setSaveSuccess(false);
  }

  async function saveRoster() {
    setSaving(true);
    setErrorMessage("");
    setSaveSuccess(false);
    try {
      const res = await fetch("/api/onboard/save-roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brokerage,
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name ?? "",
            whatsapp: a.whatsapp ?? "",
            role: a.role ?? "agent",
            gmailToken: a.gmailToken ?? null,
            gmailEmail: a.gmailEmail ?? null,
            kbFiles: Array.isArray(a.kbFiles) ? a.kbFiles : [],
            lastGmailSync: a.lastGmailSync ?? null,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Save failed (${res.status})`);
      }
      setErrorMessage("");
      setSaveSuccess(true);
    } catch (e) {
      setErrorMessage(e?.message || "Could not save roster.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {loading ? (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-sm text-[var(--muted)]">
          Loading roster…
        </p>
      ) : null}

      {!loading && errorMessage ? (
        <div
          className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          {errorMessage}
        </div>
      ) : null}

      {!loading && saveSuccess ? (
        <div
          className="mb-6 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
          role="status"
        >
          Saved successfully.
        </div>
      ) : null}

      {!loading ? (
        <>
          <section className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                Brokerage name
              </span>
              <input
                type="text"
                value={brokerage}
                onChange={(e) => {
                  setBrokerage(e.target.value);
                  setSaveSuccess(false);
                }}
                className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--foreground)] outline-none ring-[var(--cyan)]/30 placeholder:text-[var(--muted)] focus:border-[var(--cyan)]/50 focus:ring-2"
                placeholder="Sterling Boulevard"
                autoComplete="organization"
              />
            </label>
          </section>

          <section className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-medium text-[var(--foreground)]">
                Agent roster
              </h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={addAgent}
                  disabled={saving}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-white/5 disabled:opacity-50"
                >
                  Add Agent
                </button>
                <button
                  type="button"
                  onClick={saveRoster}
                  disabled={saving}
                  className="rounded-lg border-2 border-white/25 bg-white px-4 py-2 text-sm font-bold text-[#0a0a0a] shadow-md shadow-black/30 hover:bg-neutral-100 active:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="w-full min-w-[800px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)]">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">WhatsApp Number</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-8 text-center text-[var(--muted)]"
                      >
                        No agents yet. Click &quot;Add Agent&quot; to add a row.
                      </td>
                    </tr>
                  ) : (
                    agents.map((agent) => (
                      <tr
                        key={agent.id}
                        className="border-b border-[var(--border)] last:border-b-0"
                      >
                        <td className="px-3 py-2 align-middle">
                          <input
                            type="text"
                            value={agent.name ?? ""}
                            onChange={(e) =>
                              updateAgent(agent.id, "name", e.target.value)
                            }
                            className="w-full min-w-[120px] rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--cyan)]/40"
                            placeholder="Name"
                          />
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <input
                            type="text"
                            value={agent.whatsapp ?? ""}
                            onChange={(e) =>
                              updateAgent(agent.id, "whatsapp", e.target.value)
                            }
                            className="w-full min-w-[140px] rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--cyan)]/40"
                            placeholder="+971…"
                          />
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <select
                            value={agent.role === "admin" ? "admin" : "agent"}
                            onChange={(e) =>
                              updateAgent(agent.id, "role", e.target.value)
                            }
                            className="w-full min-w-[96px] rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--cyan)]/40"
                          >
                            <option value="agent">Agent</option>
                            <option value="admin">Admin</option>
                          </select>
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <div className="max-w-[220px] space-y-0.5 text-xs leading-relaxed text-[var(--muted)]">
                            <p className="text-[var(--foreground)]">
                              <span className="text-[var(--muted)]">
                                KB files loaded:{" "}
                              </span>
                              {kbFilesCount(agent)}
                            </p>
                            <p className="text-[var(--foreground)]">
                              <span className="text-[var(--muted)]">
                                Gmail connected:{" "}
                              </span>
                              {gmailConnectedLabel(agent)}
                            </p>
                            <p className="text-[var(--foreground)]">
                              <span className="text-[var(--muted)]">
                                Last sync:{" "}
                              </span>
                              {lastSyncLabel(agent)}
                            </p>
                          </div>
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              disabled
                              className="rounded border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1 text-xs font-medium text-[var(--muted)] cursor-not-allowed"
                              title="Gmail OAuth not available yet"
                            >
                              Connect Gmail
                            </button>
                            <button
                              type="button"
                              onClick={() => removeAgent(agent.id)}
                              disabled={saving}
                              className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
