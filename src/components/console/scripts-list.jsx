"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Strip } from "@/components/ui/strip";
import { ConsoleShell } from "@/components/console/console-shell";
import { runsLabel } from "@/lib/scripts/display";

export function ScriptsList({ tenant }) {
  const router = useRouter();
  const [scripts, setScripts] = useState(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/scripts");
    if (res.status === 401) {
      window.location.href = `/copilot/login?next=/copilot/${encodeURIComponent(tenant)}/scripts`;
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not load scripts.");
    setScripts(body.scripts || []);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [tenant]);

  async function createScript(event) {
    event.preventDefault();
    const display_name = newName.trim();
    if (!display_name || saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/scripts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not create script.");
      router.push(`/copilot/${encodeURIComponent(tenant)}/scripts/${body.id}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  function openScript(id) {
    router.push(`/copilot/${encodeURIComponent(tenant)}/scripts/${id}`);
  }

  return (
    <ConsoleShell tenant={tenant} width={1040}>
      <div className="mb-3.5 flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="az-h1 mb-2.5 text-fg">Call scripts</h1>
          <p className="max-w-[560px] text-[17px] text-dim">
            What AgentZero says when it rings a lead. Only a{" "}
            <span className="text-az">LIVE</span> script can be used on a list —
            drafts are yours to play with.
          </p>
        </div>
        {creating ? null : (
          <Button onClick={() => setCreating(true)} variant="white">
            New script
          </Button>
        )}
      </div>

      {error ? (
        <Strip className="mt-6" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}

      {creating ? (
        <form className="az-card mt-6 p-6.5" onSubmit={createScript}>
          <Label htmlFor="script-name">Name the script</Label>
          <Field
            autoFocus
            id="script-name"
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Cold list"
            value={newName}
          />
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Button disabled={saving || !newName.trim()} type="submit">
              {saving ? "Creating…" : "Create"}
            </Button>
            <Button
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
              type="button"
              variant="quiet"
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mt-9 border-t border-line">
        {scripts == null ? (
          <>
            <div className="az-row h-[86px]" />
            <div className="az-row h-[86px]" />
            <div className="az-row h-[86px]" />
          </>
        ) : scripts.length === 0 ? (
          <p className="py-8 text-[15px] text-dim">
            No scripts yet. Create one with New script.
          </p>
        ) : (
          scripts.map((script) => (
            <button
              className="az-row hover:bg-panel"
              key={script.id}
              onClick={() => openScript(script.id)}
              type="button"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[19px] font-medium text-fg">
                    {script.display_name}
                  </span>
                  <span
                    className={
                      script.status === "live" ? "az-pill-live" : "az-pill-draft"
                    }
                  >
                    {script.status === "live" ? "LIVE" : "DRAFT"}
                  </span>
                </div>
                <div className="mt-1.5 text-sm text-dim">
                  {[
                    script.goal_label || "No goal yet",
                    script.voice_label || "No voice yet",
                    runsLabel(script.runs),
                  ].join(" · ")}
                </div>
              </div>
              <span className="font-mono text-xs text-ghost">
                v{script.current_version}
              </span>
              <span className="rounded-lg border border-line-2 px-4 py-2.5 text-sm text-dim">
                Edit
              </span>
            </button>
          ))
        )}
      </div>
    </ConsoleShell>
  );
}
