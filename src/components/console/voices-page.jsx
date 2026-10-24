"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { Strip } from "@/components/ui/strip";
import { ConsoleShell } from "@/components/console/console-shell";
import { consoleBase } from "@/lib/console/client";

const VOICES = [
  { id: "Jot7IsvC9VkWPLPjLDKw", name: "Allan", accent: "English", note: "Live voice today" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", accent: "English" },
  { id: "aGv5jHWKBy8K5xKvYeSX", name: "Sal", accent: "English" },
  { id: "6fZce9LFNG3iEITDfqZZ", name: "Charlotte", accent: "English" },
  { id: "f1abxvIEijusskcPWE5x", name: "Monika", accent: "Hindi" },
  { id: "DbbNuBL7lf62XwY7arQb", name: "Hugo", accent: "French" },
  { id: "D2dHiTSPRx6l2bhKGmyJ", name: "Halime", accent: "Turkish" },
];

const DEFAULT_LINE =
  "Hi, we saw your enquiry. We've got the top below-market deals in Downtown right now. Would you like a complete brochure of them sent to your WhatsApp or email?";

export function VoicesPage({ tenant }) {
  const base = consoleBase(tenant);
  const [text, setText] = useState(DEFAULT_LINE);
  const [customId, setCustomId] = useState("");
  const [loadingId, setLoadingId] = useState(null);
  const [playingId, setPlayingId] = useState(null);
  const [error, setError] = useState("");
  const cache = useRef(new Map());
  const audio = useRef(null);

  useEffect(() => {
    const urls = cache.current;
    return () => {
      audio.current?.pause();
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
  }, []);

  function stop() {
    audio.current?.pause();
    audio.current = null;
    setPlayingId(null);
  }

  async function play(voiceId) {
    if (playingId === voiceId) {
      stop();
      return;
    }
    stop();
    setError("");
    const key = `${voiceId}::${text.trim()}`;
    let url = cache.current.get(key);
    if (!url) {
      setLoadingId(voiceId);
      try {
        const res = await fetch("/api/console/voices/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ voiceId, text }),
        });
        if (res.status === 401) {
          window.location.href = `/copilot?next=${encodeURIComponent(base)}`;
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Could not generate that voice.");
        }
        url = URL.createObjectURL(await res.blob());
        cache.current.set(key, url);
      } catch (err) {
        setError(err.message);
        return;
      } finally {
        setLoadingId(null);
      }
    }
    const el = new Audio(url);
    el.onended = () => setPlayingId((current) => (current === voiceId ? null : current));
    audio.current = el;
    setPlayingId(voiceId);
    el.play().catch((err) => {
      setError(err.message);
      setPlayingId(null);
    });
  }

  function label(voiceId) {
    if (loadingId === voiceId) return "Generating…";
    if (playingId === voiceId) return "Stop";
    return "Play";
  }

  const busy = Boolean(loadingId) || !text.trim();
  const custom = customId.trim();

  return (
    <ConsoleShell tenant={tenant} width={820}>
      <Link className="mb-6 inline-block text-sm text-dim hover:text-fg" href={`${base}/settings`}>
        ← Settings
      </Link>
      <h1 className="az-h1 mb-3 text-fg">Test voices</h1>
      <p className="mb-10 text-lg text-dim">
        Every voice reads the same line. Tap play to hear how each one sounds on a call.
      </p>

      {error ? (
        <Strip className="mb-8" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}

      <div className="mb-10">
        <Label htmlFor="line">What they say</Label>
        <Field
          as="textarea"
          id="line"
          maxLength={600}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          value={text}
        />
        {text !== DEFAULT_LINE ? (
          <button
            className="mt-2 text-sm text-dim hover:text-fg"
            onClick={() => setText(DEFAULT_LINE)}
            type="button"
          >
            Reset to default line
          </button>
        ) : null}
      </div>

      <div className="az-eyebrow mb-4 block">VOICES</div>
      <div className="mb-12 grid gap-3 sm:grid-cols-2">
        {VOICES.map((voice) => (
          <div
            className={`az-card flex items-center justify-between gap-4 px-5.5 py-5 ${playingId === voice.id ? "border-az" : ""}`}
            key={voice.id}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[19px] font-semibold text-fg">{voice.name}</span>
                <Pill tone={voice.accent === "English" ? undefined : "warn"}>
                  {voice.accent}
                </Pill>
              </div>
              {voice.note ? (
                <div className="mt-1 text-sm text-dim">{voice.note}</div>
              ) : null}
            </div>
            <Button
              disabled={busy && playingId !== voice.id}
              onClick={() => play(voice.id)}
              variant={playingId === voice.id ? "secondary" : undefined}
            >
              {label(voice.id)}
            </Button>
          </div>
        ))}
      </div>

      <div className="az-eyebrow mb-4 block">TRY ANY ELEVENLABS VOICE</div>
      <div className="az-card flex flex-wrap items-end gap-3 px-5.5 py-5">
        <div className="min-w-[240px] flex-1">
          <Label htmlFor="custom">Voice ID</Label>
          <Field
            id="custom"
            onChange={(e) => setCustomId(e.target.value)}
            placeholder="Paste a voice ID from ElevenLabs"
            value={customId}
          />
        </div>
        <Button
          disabled={!custom || (busy && playingId !== custom)}
          onClick={() => play(custom)}
        >
          {custom ? label(custom) : "Play"}
        </Button>
      </div>
    </ConsoleShell>
  );
}
