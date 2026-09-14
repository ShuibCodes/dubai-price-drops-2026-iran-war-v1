"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConsoleShell } from "@/components/console/console-shell";
import { Tooltip } from "@/components/console/tooltip";
import { Button } from "@/components/ui/button";
import { Check } from "@/components/ui/check";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { Strip } from "@/components/ui/strip";
import { consoleJson } from "@/lib/console/client";
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
      await consoleJson(listHref, `/api/scripts/${scriptId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        fallback: "Save failed.",
        body: JSON.stringify({
          display_name: name.trim(),
          config: {
            ...config,
            opening_line: normalizeOpening(config.opening_line),
          },
        }),
      });
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
      await consoleJson(listHref, `/api/scripts/${scriptId}/publish`, {
        method: "POST",
        fallback: "Publish failed.",
      });
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
      await consoleJson(listHref, `/api/scripts/${scriptId}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        fallback: "Restore failed.",
        body: JSON.stringify({ version_no: versionNo }),
      });
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
      const body = await consoleJson(listHref, `/api/scripts/${scriptId}/test-call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        fallback: "Talk here failed.",
        body: JSON.stringify({ mode: "web" }),
      });
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
        await consoleJson(listHref, `/api/scripts/${scriptId}/test-call`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          fallback: "Test call failed.",
          body: JSON.stringify({}),
        });
        setTestState("calling");
      } catch (err) {
        setTestState(null);
        setError(err.message);
      }
    }, 3000);
  }

  const status = script?.status === "live" ? "live" : "draft";
  const needsSave = dirty || !latest;
  let barLeft = "Hear it before your leads do.";
  if (dirty) barLeft = "Unsaved changes";
  else if (latestPublished) {
    barLeft = `v${latestPublished.version_no} · published ${formatRelative(latestPublished.published_at)}`;
  } else if (latest) {
    barLeft = `Draft · edited ${formatRelative(latest.created_at)}`;
  }

  return (
    <ConsoleShell footer={false} tenant={tenant} width={760}>
      <Link
        className="mb-5 inline-block font-mono text-[11px] tracking-[.14em] text-faint hover:text-fg"
        href={listHref}
      >
        ← ALL SCRIPTS
      </Link>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          aria-label="Script name"
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent text-[40px] font-semibold leading-none tracking-[-.03em] text-fg outline-none hover:border-line-2 focus:border-az"
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
        <span className={status === "live" ? "az-pill-live" : "az-pill-draft"}>
          {status === "live" ? `LIVE · v${script?.current_version}` : "DRAFT"}
        </span>
      </div>
      <p className="mb-4 text-[17px] text-dim">
        Four questions. Plain English — write it the way you would brief a new
        junior.
      </p>
      <div className="mb-10 font-mono text-[11px] text-faint">
        {latestPublished ? (
          <>
            Last published by {latestPublished.published_by_name || "Unknown"} ·{" "}
            {formatDay(latestPublished.published_at)}
          </>
        ) : (
          <>Not published yet</>
        )}
      </div>

      {error ? (
        <Strip className="mb-8" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}

      {loading ? (
        <div className="az-card p-6.5 text-[15px] text-dim">Loading…</div>
      ) : (
        <div className="grid gap-[30px]">
          <div>
            <Label className="flex items-center gap-2" htmlFor="goal">
              What is the goal of the call
              <Tooltip>
                One sentence. The call ends as soon as this is answered — so keep
                it to a single thing.
              </Tooltip>
            </Label>
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
            <Label htmlFor="opening">How should it open</Label>
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
            <div className="mt-2 text-[13px] text-faint">
              The AI disclosure is required on every call in the UAE. It stays
              in. Supports {"{{lead}}"} and {"{{agent}}"}.
            </div>
          </div>

          <div>
            <Label className="flex items-center gap-2">
              What must it find out
              <Tooltip>
                These come back to you as one line per lead in WhatsApp. Three or
                four max — more and the call drags.
              </Tooltip>
            </Label>
            <div className="grid gap-2.5">
              {(config.find_out || []).map((item, index) => (
                <div
                  className="flex items-center gap-3 rounded-[10px] border border-line-2 bg-field px-[18px] py-3.5"
                  key={`${item.label}-${index}`}
                >
                  <span className="font-mono text-xs text-ghost">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 text-base text-fg">{item.label}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[.12em] text-ghost">
                    → {item.type}
                  </span>
                  <button
                    aria-label={`Remove ${item.label}`}
                    className="text-[15px] text-ghost hover:text-fg"
                    onClick={() => removeFindOut(index)}
                    type="button"
                  >
                    ✕
                  </button>
                </div>
              ))}

              {addingFindOut ? (
                <div className="grid gap-2.5 rounded-[10px] border border-line-2 bg-panel-2 p-4">
                  <Field
                    autoFocus
                    onChange={(event) =>
                      setNewFindOut((current) => ({
                        ...current,
                        label: event.target.value,
                      }))
                    }
                    placeholder="The question to ask"
                    value={newFindOut.label}
                  />
                  <div className="flex flex-wrap gap-2.5">
                    <Field
                      as="select"
                      className="flex-1"
                      onChange={(event) =>
                        setNewFindOut((current) => ({
                          ...current,
                          type: event.target.value,
                        }))
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
                      disabled={
                        !newFindOut.label.trim() ||
                        (config.find_out || []).length >= 8
                      }
                      onClick={addFindOut}
                    >
                      Add
                    </Button>
                    <Button
                      onClick={() => setAddingFindOut(false)}
                      variant="quiet"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  className="rounded-[10px] border border-dashed border-[#2c332f] px-[18px] py-3.5 text-left text-[15px] text-dim hover:border-az hover:text-az disabled:opacity-40"
                  disabled={(config.find_out || []).length >= 8}
                  onClick={() => setAddingFindOut(true)}
                  type="button"
                >
                  + Add another
                </button>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="voice">Voice</Label>
            <div className="flex flex-wrap gap-2.5">
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
              <Strip
                className="mt-2.5"
                onDismiss={() => setVoicePreview(false)}
                tone="default"
              >
                <span>You will hear this voice on the next test call.</span>
              </Strip>
            ) : null}
          </div>

          <div>
            <Label>Rules</Label>
            <div className="az-card px-5 py-1">
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
            <p className="mt-2 text-[13px] text-faint">
              Colour for this script only. Core behaviour and privacy rules are
              set by AgentZero and cannot be changed here.
            </p>
          </div>

          <div>
            <button
              className="flex w-full items-center justify-between border-t border-line py-4 font-mono text-[11px] tracking-[.14em] text-faint hover:text-fg"
              onClick={() => setHistoryOpen((open) => !open)}
              type="button"
            >
              <span>VERSION HISTORY</span>
              <span>{historyOpen ? "−" : "+"}</span>
            </button>
            {historyOpen ? (
              versions.length === 0 ? (
                <p className="py-3 text-[15px] text-dim">No versions yet.</p>
              ) : (
                <div className="grid gap-px overflow-hidden rounded-[10px] bg-hairline">
                  {versions.map((row) => {
                    const isLive = Boolean(row.published_at);
                    return (
                      <div
                        className="flex flex-wrap items-center gap-4 bg-panel px-[18px] py-[15px]"
                        key={row.id}
                      >
                        <span
                          className={`w-7 font-mono text-xs ${isLive ? "text-az" : "text-faint"}`}
                        >
                          v{row.version_no}
                        </span>
                        <span
                          className={`min-w-[120px] flex-1 text-[15px] ${isLive ? "text-fg-soft" : "text-dim"}`}
                        >
                          {runsLabel(row.runs)}
                        </span>
                        <span className="text-[13px] text-faint">
                          {formatDay(row.published_at || row.created_at)} ·{" "}
                          {row.published_by_name || "Draft"}
                        </span>
                        {isLive && row.version_no === latestPublished?.version_no ? (
                          <span className="font-mono text-[10px] text-az">LIVE</span>
                        ) : isAdmin ? (
                          <button
                            className="text-[13px] text-dim hover:text-az disabled:opacity-40"
                            disabled={busy}
                            onClick={() => restore(row.version_no)}
                            type="button"
                          >
                            Restore
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )
            ) : null}
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-line-2 bg-shell/95 backdrop-blur">
        <div className="mx-auto max-w-[760px] px-6 py-4">
          {testState === "confirm" ? (
            <Strip className="mb-3" tone="live">
              <span>Calling {maskPhone(waPhone)} now with this version.</span>
              <Button onClick={cancelTest} variant="quiet">
                Cancel
              </Button>
            </Strip>
          ) : null}
          {testState === "calling" ? (
            <Strip className="mb-3">
              <span>Calling you now…</span>
            </Strip>
          ) : null}
          {webState === "connecting" ? (
            <Strip className="mb-3">
              <span>Connecting in this tab…</span>
            </Strip>
          ) : null}
          {webState === "live" ? (
            <Strip className="mb-3" tone="live">
              <span>
                {webHearing
                  ? "Hearing you — keep talking."
                  : "In this tab · speak to start. Not the live line."}
              </span>
              <Button onClick={hangUpWeb} variant="quiet">
                Hang up
              </Button>
            </Strip>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <div
              className={`min-w-[160px] flex-1 text-sm ${dirty ? "text-warn" : "text-dim"}`}
            >
              {barLeft}
            </div>
            {needsSave ? (
              <Button
                disabled={saving}
                onClick={() => save().catch(() => {})}
                variant="secondary"
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            ) : null}
            <Button
              disabled={
                needsSave || saving || publishing || Boolean(testState) || Boolean(webState)
              }
              onClick={talkHere}
              variant="secondary"
            >
              ▶ Talk here
            </Button>
            <Button
              disabled={
                needsSave || saving || publishing || Boolean(testState) || Boolean(webState)
              }
              onClick={testCall}
              variant="secondary"
            >
              Test call me
            </Button>
            {isAdmin ? (
              <span className="relative inline-flex items-center gap-2">
                <Button
                  disabled={publishing || saving || Boolean(webState)}
                  onClick={publish}
                >
                  {publishing ? "Publishing…" : "Publish"}
                </Button>
                <Tooltip align="right">
                  Publishing makes this LIVE — it can then be used on real lists.
                  Admins only.
                </Tooltip>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </ConsoleShell>
  );
}
