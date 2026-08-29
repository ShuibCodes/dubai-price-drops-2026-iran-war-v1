"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Row } from "@/components/ui/row";
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
      window.location.href = `/copilot?next=/copilot/${encodeURIComponent(tenant)}/scripts`;
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
    <ConsoleShell
      action={
        <Button onClick={() => setCreating(true)} variant="primary">
          New script
        </Button>
      }
      tenant={tenant}
      title="Scripts"
    >
      {error ? (
        <Strip className="mb-4" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}

      {creating ? (
        <form className="mb-6 border border-rule-2 bg-surface p-4" onSubmit={createScript}>
          <Field
            autoFocus
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Script name"
            value={newName}
          />
          <div className="mt-3 flex gap-2">
            <Button disabled={saving || !newName.trim()} type="submit">
              {saving ? "Creating…" : "Create"}
            </Button>
            <Button
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <div className="border-t border-rule">
        {scripts == null ? (
          <>
            <Row sub=" " title=" " />
            <Row sub=" " title=" " />
            <Row sub=" " title=" " />
          </>
        ) : scripts.length === 0 ? (
          <p className="py-8 text-sm text-ink-2">
            No scripts yet. Create one with New script.
          </p>
        ) : (
          scripts.map((script) => (
            <Row
              key={script.id}
              onClick={() => openScript(script.id)}
              right={
                <>
                  <Pill tone={script.status === "live" ? "live" : "draft"}>
                    {script.status === "live" ? "LIVE" : "DRAFT"}
                  </Pill>
                  <Button
                    onClick={(event) => {
                      event.stopPropagation();
                      openScript(script.id);
                    }}
                    variant="secondary"
                  >
                    Edit
                  </Button>
                </>
              }
              sub={`${script.goal_label || "No goal"} · ${script.voice_label || "No voice"} · ${runsLabel(script.runs)}`}
              title={script.display_name}
            />
          ))
        )}
      </div>
    </ConsoleShell>
  );
}
