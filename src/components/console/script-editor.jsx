"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConsoleShell } from "@/components/console/console-shell";
import { Button } from "@/components/ui/button";
import { Check } from "@/components/ui/check";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { Row } from "@/components/ui/row";
import { Strip } from "@/components/ui/strip";
import {
  formatDay,
  formatRelative,
  maskPhone,
  runsLabel,
} from "@/lib/scripts/display";
import { GOALS, RULES, VOICE_ALLOWLIST } from "@/lib/scripts/schema";
import { joinWebTalk, leaveWebTalk, unlockMicrophone } from "@/lib/scripts/web-talk-client";

const FIND_OUT_TYPES = [
  { id: "choice", label: "choice" },
  { id: "number", label: "number" },
  { id: "text", label: "text" },
];

function blankConfig() {
  return {
    goal: "qualify",
    voice_id: VOICE_ALLOWLIST[0].id,
    opening_line: "",
    find_out: [],
    rules: RULES.filter((rule) => rule.locked).map((rule) => rule.key),
    extra_context: "",
  };
}

function normalizeOpening(value) {
  return String(value || "")
    .replaceAll("{{lead}}", "{{leadName}}")
    .replaceAll("{{agent}}", "{{agent_name}}");
}

function displayOpening(value) {
  return String(value || "")
    .replaceAll("{{leadName}}", "{{lead}}")
    .replaceAll("{{agent_name}}", "{{agent}}");
}

function cloneConfig(raw) {
  const next = { ...blankConfig(), ...(raw || {}) };
  next.find_out = Array.isArray(next.find_out)
    ? next.find_out.map((item) => ({ ...item }))
    : [];
  next.rules = Array.isArray(next.rules) ? [...next.rules] : [];
  if (!next.rules.includes("ai_disclosure")) {
    next.rules = ["ai_disclosure", ...next.rules];
  }
  next.opening_line = displayOpening(next.opening_line);
  return next;
}

function sameConfig(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function ScriptEditor({ tenant, scriptId, role, waPhone }) {
  const router = useRouter();
  const isAdmin = role === "admin";
  const listHref = `/copilot/${encodeURIComponent(tenant)}/scripts`;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [script, setScript] = useState(null);
  const [versions, setVersions] = useState([]);
  const [name, setName] = useState("");
  const [config, setConfig] = useState(blankConfig);
  const [savedName, setSavedName] = useState("");
  const [savedConfig, setSavedConfig] = useState(blankConfig);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [addingFindOut, setAddingFindOut] = useState(false);
  const [newFindOut, setNewFindOut] = useState({ label: "", type: "text" });
  const [voicePreview, setVoicePreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [testState, setTestState] = useState(null);
  const [webState, setWebState] = useState(null);
  const [webHearing, setWebHearing] = useState(false);
  const [busy, setBusy] = useState(false);
  const testTimer = useRef(null);
  const webSession = useRef(null);

  const dirty = useMemo(
    () => name.trim() !== savedName || !sameConfig(config, savedConfig),
    [name, savedName, config, savedConfig]
  );

  const latestPublished = versions.find((row) => row.published_at);
  const latest = versions[0] || null;

  async function load() {
    const res = await fetch(`/api/scripts/${scriptId}`);
    if (res.status === 401) {
      window.location.href = `/copilot?next=${encodeURIComponent(listHref + "/" + scriptId)}`;
      return;
    }
    if (res.status === 404) {
      router.replace(listHref);
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not load script.");
    const nextConfig = cloneConfig(body.versions?.[0]?.config);
    setScript(body.script);
    setVersions(body.versions || []);
    setName(body.script.display_name);
    setSavedName(body.script.display_name);
    setConfig(nextConfig);
    setSavedConfig(nextConfig);
  }

  useEffect(() => {
    load()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [scriptId]);

  useEffect(() => {
    return () => {
      if (testTimer.current) window.clearTimeout(testTimer.current);
      leaveWebTalk(webSession.current);
    };
  }, []);

  function patchConfig(partial) {
    setConfig((current) => ({ ...current, ...partial }));
  }

  function toggleRule(key, on) {
    const rule = RULES.find((item) => item.key === key);
    if (rule?.locked) return;
    const next = new Set(config.rules || []);
    if (on) next.add(key);
    else next.delete(key);
    next.add("ai_disclosure");
    patchConfig({ rules: RULES.map((item) => item.key).filter((item) => next.has(item)) });
  }

  function removeFindOut(index) {
    patchConfig({
      find_out: (config.find_out || []).filter((_, i) => i !== index),
    });
  }

  function addFindOut() {
    const label = newFindOut.label.trim();
    if (!label) return;
    const items = [...(config.find_out || [])];
    if (items.length >= 8) return;
    items.push({ label, type: newFindOut.type });
    patchConfig({ find_out: items });
    setNewFindOut({ label: "", type: "text" });
    setAddingFindOut(false);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/scripts/${scriptId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: name.trim(),
          config: {
            ...config,
            opening_line: normalizeOpening(config.opening_line),
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Save failed.");
      await load();
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!isAdmin) return;
    setPublishing(true);
    setError("");
    try {
      if (dirty || !latest) await save();
      const res = await fetch(`/api/scripts/${scriptId}/publish`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Publish failed.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  }

  async function restore(versionNo) {
    if (!isAdmin) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/scripts/${scriptId}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version_no: versionNo }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Restore failed.");
      setHistoryOpen(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function cancelTest() {
    if (testTimer.current) {
      window.clearTimeout(testTimer.current);
      testTimer.current = null;
    }
    setTestState(null);
  }

  async function hangUpWeb() {
    const session = webSession.current;
    webSession.current = null;
    setWebState(null);
    setWebHearing(false);
    await leaveWebTalk(session);
  }

  async function talkHere() {
    if (dirty || !latest || testState || webState) return;
    setError("");
    setWebState("connecting");
    try {
      await unlockMicrophone();
      await leaveWebTalk(webSession.current);
      webSession.current = null;
      const res = await fetch(`/api/scripts/${scriptId}/test-call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "web" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Talk here failed.");
      if (!body.webCallUrl) throw new Error("Talk here did not return a join URL.");
      const session = await joinWebTalk({
        webCallUrl: body.webCallUrl,
        callToken: body.callToken,
        onLocalLevel: (level) => setWebHearing(level > 0.02),
      });
      webSession.current = session;
      session.call.on("left-meeting", () => {
        leaveWebTalk(session).catch(() => {});
        if (webSession.current?.call === session.call) {
          webSession.current = null;
          setWebState(null);
          setWebHearing(false);
        }
      });
      setWebState("live");
      setWebHearing(false);
    } catch (err) {
      webSession.current = null;
      await leaveWebTalk(null);
      setWebState(null);
      setWebHearing(false);
      const denied =
        err?.name === "NotAllowedError" || err?.name === "NotFoundError";
      const duplicate = /duplicate dailyiframe/i.test(String(err?.message || ""));
      setError(
        denied
          ? "Allow the microphone to talk here."
          : duplicate
            ? "A previous in-tab call was still open. Try Talk here again."
            : err.message || "Talk here failed."
      );
    }
  }

  function testCall() {
    if (dirty || !latest || testState || webState) return;
    setError("");
    setTestState("confirm");
    testTimer.current = window.setTimeout(async () => {
      testTimer.current = null;
      try {
        const res = await fetch(`/api/scripts/${scriptId}/test-call`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Test call failed.");
        setTestState("calling");
      } catch (err) {
        setTestState(null);
        setError(err.message);
      }
    }, 3000);
  }

  const status = script?.status === "live" ? "live" : "draft";
  const needsSave = dirty || !latest;
  let barLeft = "Draft";
  if (dirty) barLeft = "Unsaved changes";
  else if (latestPublished) {
    barLeft = `v${latestPublished.version_no} · published ${formatRelative(latestPublished.published_at)}`;
  } else if (latest) {
    barLeft = `Draft · edited ${formatRelative(latest.created_at)}`;
  }

  return (
    <ConsoleShell tenant={tenant} title={name || "Script"}>
      <Link
        className="mb-6 inline-block text-sm text-ink-3 hover:text-ink-2"
        href={listHref}
      >
        ← All scripts
      </Link>

      {error ? (
        <Strip className="mb-4" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}

      {loading ? (
        <div className="border border-rule bg-surface p-5 text-sm text-ink-3">Loading…</div>
      ) : (
        <div className="border border-rule bg-surface">
          <div className="space-y-8 p-5 pb-28">
            <div>
              <div className="relative">
                <Field
                  className="pr-20 text-lg font-medium"
                  onChange={(event) => setName(event.target.value)}
                  value={name}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Pill tone={status === "live" ? "live" : "draft"}>
                    {status === "live" ? "LIVE" : "DRAFT"}
                  </Pill>
                </div>
              </div>
              <div className="mt-2 font-mono text-[11px] text-ink-3">
                {latestPublished ? (
                  <>
                    Last published by {latestPublished.published_by_name || "Unknown"} ·{" "}
                    {formatDay(latestPublished.published_at)} ·{" "}
                  </>
                ) : (
                  <>Not published yet · </>
                )}
                <button
                  className="underline-offset-2 hover:underline"
                  onClick={() => setHistoryOpen((open) => !open)}
                  type="button"
                >
                  View history
                </button>
              </div>
              {historyOpen ? (
                <div className="mt-3 border-t border-rule">
                  {versions.length === 0 ? (
                    <p className="py-3 text-sm text-ink-3">No versions yet.</p>
                  ) : (
                    versions.map((row) => (
                      <Row
                        key={row.id}
                        right={
                          isAdmin ? (
                            <Button
                              disabled={busy}
                              onClick={() => restore(row.version_no)}
                              variant="secondary"
                            >
                              Restore
                            </Button>
                          ) : null
                        }
                        sub={runsLabel(row.runs)}
                        title={`v${row.version_no} · ${row.published_by_name || "Draft"} · ${formatDay(row.published_at || row.created_at)}`}
                      />
                    ))
                  )}
                </div>
              ) : null}
            </div>

            <div>
              <Label htmlFor="goal">Goal</Label>
              <Field
                as="select"
                id="goal"
                onChange={(event) => patchConfig({ goal: event.target.value })}
                value={config.goal}
              >
                {GOALS.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.label}
                  </option>
                ))}
              </Field>
            </div>

            <div>
              <Label htmlFor="voice">Voice</Label>
              <div className="flex gap-2">
                <Field
                  as="select"
                  className="flex-1"
                  id="voice"
                  onChange={(event) => patchConfig({ voice_id: event.target.value })}
                  value={config.voice_id}
                >
                  {VOICE_ALLOWLIST.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.label}
                    </option>
                  ))}
                </Field>
                <Button onClick={() => setVoicePreview(true)} variant="secondary">
                  Preview
                </Button>
              </div>
              {voicePreview ? (
                <Strip className="mt-2" tone="default">
                  <span>You’ll hear this voice on the next test call.</span>
                  <Button onClick={() => setVoicePreview(false)} variant="ghost">
                    Dismiss
                  </Button>
                </Strip>
              ) : null}
            </div>

            <div>
              <Label htmlFor="opening">Opening line</Label>
              <Field
                as="textarea"
                id="opening"
                maxLength={200}
                onChange={(event) => patchConfig({ opening_line: event.target.value })}
                placeholder="After they give permission, this is the frame."
                rows={3}
                trailing={`${(config.opening_line || "").length}/200`}
                value={config.opening_line}
              />
              <p className="mt-1 font-mono text-[10px] text-ink-3">
                Supports {"{{lead}}"} and {"{{agent}}"}.
              </p>
            </div>

            <div>
              <Label>What it should find out</Label>
              <div className="border-t border-rule">
                {(config.find_out || []).map((item, index) => (
                  <Check
                    checked
                    key={`${item.label}-${index}`}
                    meta={
                      <span className="font-mono text-[10px] uppercase tracking-label text-ink-3">
                        → {item.type}
                      </span>
                    }
                    onChange={(on) => {
                      if (!on) removeFindOut(index);
                    }}
                  >
                    {item.label}
                  </Check>
                ))}
              </div>
              {addingFindOut ? (
                <div className="mt-3 space-y-2">
                  <Field
                    onChange={(event) =>
                      setNewFindOut((current) => ({ ...current, label: event.target.value }))
                    }
                    placeholder="The question to ask"
                    value={newFindOut.label}
                  />
                  <div className="flex gap-2">
                    <Field
                      as="select"
                      onChange={(event) =>
                        setNewFindOut((current) => ({ ...current, type: event.target.value }))
                      }
                      value={newFindOut.type}
                    >
                      {FIND_OUT_TYPES.map((type) => (
                        <option key={type.id} value={type.id}>
                          → {type.label}
                        </option>
                      ))}
                    </Field>
                    <Button
                      disabled={!newFindOut.label.trim() || (config.find_out || []).length >= 8}
                      onClick={addFindOut}
                    >
                      Add
                    </Button>
                    <Button onClick={() => setAddingFindOut(false)} variant="ghost">
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  className="mt-3"
                  disabled={(config.find_out || []).length >= 8}
                  onClick={() => setAddingFindOut(true)}
                  variant="secondary"
                >
                  Add question
                </Button>
              )}
            </div>

            <div>
              <Label>Rules</Label>
              <div className="border-t border-rule">
                {RULES.map((rule) => (
                  <Check
                    checked={(config.rules || []).includes(rule.key)}
                    key={rule.key}
                    locked={rule.locked}
                    meta={rule.locked ? <Pill>Required</Pill> : null}
                    onChange={(on) => toggleRule(rule.key, on)}
                  >
                    {rule.label}
                  </Check>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="extra">Anything else?</Label>
              <Field
                as="textarea"
                id="extra"
                maxLength={300}
                onChange={(event) => patchConfig({ extra_context: event.target.value })}
                placeholder="Mention we're the only Emaar-approved brokerage in JLT"
                rows={3}
                trailing={`${(config.extra_context || "").length}/300`}
                value={config.extra_context}
              />
              <p className="mt-1 text-xs text-ink-3">
                Extra context for this script. Core behaviour and privacy rules are
                set by AgentZero and can’t be changed here.
              </p>
            </div>
          </div>

          <div className="sticky bottom-0 border-t border-rule bg-surface">
            {testState === "confirm" ? (
              <Strip tone="live">
                <span>
                  Calling {maskPhone(waPhone)} now with this version.
                </span>
                <Button onClick={cancelTest} variant="ghost">
                  Cancel
                </Button>
              </Strip>
            ) : null}
            {testState === "calling" ? (
              <Strip>
                <span className="text-ink-3">Calling you now…</span>
              </Strip>
            ) : null}
            {webState === "connecting" ? (
              <Strip>
                <span className="text-ink-3">Connecting in this tab…</span>
              </Strip>
            ) : null}
            {webState === "live" ? (
              <Strip tone="live">
                <span>
                  {webHearing
                    ? "Hearing you — keep talking."
                    : "In this tab · speak to start. Not the live line."}
                </span>
                <Button onClick={hangUpWeb} variant="ghost">
                  Hang up
                </Button>
              </Strip>
            ) : null}
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <p
                className={`font-mono text-[11px] ${dirty ? "text-warn" : "text-ink-3"}`}
              >
                {barLeft}
              </p>
              <div className="flex items-center gap-2">
                {needsSave ? (
                  <Button disabled={saving} onClick={() => save().catch(() => {})} variant="secondary">
                    {saving ? "Saving…" : "Save"}
                  </Button>
                ) : null}
                <Button
                  disabled={needsSave || saving || publishing || Boolean(testState) || Boolean(webState)}
                  onClick={talkHere}
                  variant="ghost"
                >
                  Talk here
                </Button>
                <Button
                  disabled={needsSave || saving || publishing || Boolean(testState) || Boolean(webState)}
                  onClick={testCall}
                  variant={needsSave ? "ghost" : "secondary"}
                >
                  Test call me
                </Button>
                {isAdmin ? (
                  <Button disabled={publishing || saving || Boolean(webState)} onClick={publish}>
                    {publishing ? "Publishing…" : "Publish"}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </ConsoleShell>
  );
}
