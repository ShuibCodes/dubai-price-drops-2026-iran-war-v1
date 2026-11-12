"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Drop } from "@/components/ui/drop";
import { Pill } from "@/components/ui/pill";
import { Strip } from "@/components/ui/strip";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ConsoleShell } from "@/components/console/console-shell";
import { consoleBase, consoleJson } from "@/lib/console/client";
import { uploadKnowledgeFile } from "@/lib/console/kb-upload";
import { KB_ACCEPT } from "@/lib/kb/documents";

function fileType(filename) {
  const ext = String(filename || "").split(".").pop();
  if (!ext || ext === filename) return "FILE";
  return ext.slice(0, 4).toUpperCase();
}

function fileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function KbPage({ tenant }) {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [confirmId, setConfirmId] = useState("");

  // Website crawler state
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [subUrl, setSubUrl] = useState("");
  const [showSubUrl, setShowSubUrl] = useState(false);
  const [crawlJob, setCrawlJob] = useState(null);
  const [isStartingCrawl, setIsStartingCrawl] = useState(false);
  const [kbText, setKbText] = useState("");
  const [savedKbText, setSavedKbText] = useState("");
  const [isSavingText, setIsSavingText] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState("");
  const pollTimerRef = useRef(null);

  const base = consoleBase(tenant);

  // Load existing KB documents and compiled knowledge text
  const load = useCallback(async () => {
    try {
      const [docBody, textBody] = await Promise.all([
        consoleJson(base, "/api/console/kb", {
          fallback: "Could not load documents.",
        }),
        consoleJson(base, "/api/console/kb/text", {
          fallback: "Could not load knowledge text.",
        }).catch(() => ({ kbText: "", sources: [] })),
      ]);

      setDocs(docBody.documents || []);

      if (textBody?.kbText != null) {
        setKbText(textBody.kbText);
        setSavedKbText(textBody.kbText);
      }

      if (textBody?.sources?.length > 0) {
        const latestWebsite = textBody.sources.find((s) => s.source_type === "website");
        if (latestWebsite?.source_url && !websiteUrl) {
          setWebsiteUrl(latestWebsite.source_url);
        }
      }
    } catch (err) {
      setError(err.message);
    }
  }, [base, websiteUrl]);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  // Cleanup poll timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // Poll active crawl job status
  const startPolling = useCallback((sourceId) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    pollTimerRef.current = setInterval(async () => {
      try {
        const data = await consoleJson(base, `/api/console/kb/crawl?sourceId=${encodeURIComponent(sourceId)}`, {
          fallback: "Polling failed",
        });

        const src = data?.source;
        if (!src) return;

        setCrawlJob(src);

        if (src.status === "ready") {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          if (src.extracted_kb) {
            setKbText(src.extracted_kb);
            setSavedKbText(src.extracted_kb);
          } else if (data?.kbText) {
            setKbText(data.kbText);
            setSavedKbText(data.kbText);
          }
          setSaveSuccessMsg("Knowledge base extracted and active for AI voice calls!");
        } else if (src.status === "failed") {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setError(src.error || "Website crawling failed. Please check the URL.");
        }
      } catch {
        // Silently continue polling
      }
    }, 2500);
  }, [base]);

  async function handleStartCrawl(isSub = false) {
    setError("");
    setSaveSuccessMsg("");
    const targetUrl = isSub ? subUrl : websiteUrl;

    if (!targetUrl.trim()) {
      setError(isSub ? "Please enter a sub-page URL." : "Please enter a website URL.");
      return;
    }

    setIsStartingCrawl(true);
    try {
      const res = await consoleJson(base, "/api/console/kb/crawl", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: targetUrl.trim(),
          isSubUrl: isSub,
        }),
        fallback: "Failed to start website extraction.",
      });

      if (res?.sourceId) {
        setCrawlJob({
          id: res.sourceId,
          status: "crawling",
          current_step: "Connecting to website and discovering pages...",
          progress_percent: 10,
          source_url: res.url,
        });
        startPolling(res.sourceId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsStartingCrawl(false);
    }
  }

  async function handleSaveKnowledgeText() {
    setError("");
    setSaveSuccessMsg("");
    setIsSavingText(true);
    try {
      const res = await consoleJson(base, "/api/console/kb/text", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kbText }),
        fallback: "Failed to save knowledge text.",
      });

      if (res?.ok) {
        setSavedKbText(kbText);
        setSaveSuccessMsg("Knowledge base saved! Injected into all outbound and test calls.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSavingText(false);
    }
  }

  async function upload(files) {
    setError("");
    for (const file of files) {
      await uploadKnowledgeFile(base, file, "private");
    }
    await load();
  }

  async function remove(id) {
    setBusyId(id);
    setError("");
    try {
      await consoleJson(base, `/api/console/kb/${id}`, {
        method: "DELETE",
        fallback: "Could not delete that document. Try again.",
      });
      setConfirmId("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  }

  async function patch(id, body) {
    setBusyId(id);
    try {
      await consoleJson(base, `/api/console/kb/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        fallback: "Update failed.",
        body: JSON.stringify(body),
      });
      await load();
    } finally {
      setBusyId("");
    }
  }

  function act(id, body) {
    patch(id, body).catch((err) => setError(err.message));
  }

  const isCrawling = crawlJob?.status === "crawling" || crawlJob?.status === "extracting";
  const wordCount = kbText ? kbText.split(/\s+/).filter(Boolean).length : 0;
  const isDirty = kbText !== savedKbText;

  return (
    <ConsoleShell tenant={tenant} width={880}>
      <h1 className="az-h1 mb-3 text-fg">Knowledge Base</h1>
      <p className="mb-9 max-w-[650px] text-lg leading-snug text-fg-2 [text-wrap:pretty]">
        Everything AgentZero is allowed to quote — on live phone calls and WhatsApp.
        Add your website to extract your brokerage background, specializations, developer partners, and policies.
      </p>

      {error ? (
        <Strip className="mb-6" tone="markup">
          <span>{error}</span>
        </Strip>
      ) : null}

      {saveSuccessMsg ? (
        <Strip className="mb-6" tone="live">
          <span>{saveSuccessMsg}</span>
        </Strip>
      ) : null}

      {/* SECTION 1: WEBSITE CRAWLER */}
      <div className="mb-10 rounded-2xl border border-line bg-panel p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="az-eyebrow text-az">AI WEBSITE CRAWLER</div>
            <h2 className="text-xl font-medium text-fg mt-1">Extract Knowledge from Website</h2>
          </div>
          {savedKbText ? (
            <Pill tone="live">Active on Calls</Pill>
          ) : (
            <Pill tone="quiet">No Knowledge Extracted</Pill>
          )}
        </div>

        <p className="mb-5 text-[14px] leading-relaxed text-dim">
          Enter your brokerage website. Our crawler visits internal pages (About, Services, Off-plan projects, Communities, Team, FAQs), and Claude synthesizes a structured knowledge base for your AI callers.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Field
              as="input"
              disabled={isCrawling || isStartingCrawl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://stageproperties.com"
              type="url"
              value={websiteUrl}
            />
          </div>
          <Button
            className="sm:w-auto px-6 whitespace-nowrap"
            disabled={isCrawling || isStartingCrawl || !websiteUrl.trim()}
            onClick={() => handleStartCrawl(false)}
            variant="primary"
          >
            {isStartingCrawl
              ? "Starting…"
              : isCrawling
              ? "Processing…"
              : savedKbText
              ? "Re-extract Website"
              : "Extract Knowledge"}
          </Button>
        </div>

        {/* SUB-URL SECTION (OPTIONAL) */}
        <div className="mt-4 pt-4 border-t border-hairline">
          {!showSubUrl ? (
            <button
              className="text-[13px] text-faint hover:text-fg transition-colors"
              onClick={() => setShowSubUrl(true)}
              type="button"
            >
              + Add a specific sub-page or project URL (e.g. Mayfair Nexus off-plan)
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-faint font-medium">
                  Additional Sub-Page / Project Launch URL
                </span>
                <button
                  className="text-[12px] text-ghost hover:text-fg"
                  onClick={() => setShowSubUrl(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <Field
                    as="input"
                    disabled={isCrawling || isStartingCrawl}
                    onChange={(e) => setSubUrl(e.target.value)}
                    placeholder="https://stageproperties.com/projects/mayfair-nexus"
                    type="url"
                    value={subUrl}
                  />
                </div>
                <Button
                  className="sm:w-auto px-5 whitespace-nowrap"
                  disabled={isCrawling || isStartingCrawl || !subUrl.trim()}
                  onClick={() => handleStartCrawl(true)}
                  variant="secondary"
                >
                  Merge Sub-Page
                </Button>
              </div>
              <p className="text-[12px] text-ghost">
                Crawls only this page and merges its project details and pricing into the existing knowledge base without overwriting your core company profile.
              </p>
            </div>
          )}
        </div>

        {/* CRAWL PROGRESS INDICATOR */}
        {crawlJob && isCrawling ? (
          <div className="mt-6 rounded-xl border border-line-2 bg-panel-2 p-4.5">
            <div className="flex items-center justify-between text-sm mb-2.5">
              <span className="font-medium text-fg flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-az animate-pulse" />
                {crawlJob.status === "crawling" ? "Crawling Website" : "Synthesizing with Claude AI"}
              </span>
              <span className="font-mono text-xs text-dim">
                {crawlJob.progress_percent || 10}%
              </span>
            </div>

            <div className="h-1.5 w-full bg-line-2 rounded-full overflow-hidden mb-3">
              <div
                className="h-full bg-az transition-all duration-500 rounded-full"
                style={{ width: `${crawlJob.progress_percent || 10}%` }}
              />
            </div>

            <p className="text-[13px] text-dim truncate">
              {crawlJob.current_step || "Processing..."}
            </p>
          </div>
        ) : null}
      </div>

      {/* SECTION 2: COMPILED KNOWLEDGE BASE EDITOR */}
      <div className="mb-12 rounded-2xl border border-line bg-panel p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <div className="az-eyebrow text-az">VOICE ASSISTANT CONTEXT</div>
            <h2 className="text-xl font-medium text-fg mt-1">Compiled Knowledge Block</h2>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[13px] font-mono text-dim">
              {wordCount} words · {kbText.length} chars
            </span>
            <Button
              disabled={isSavingText || !isDirty}
              onClick={handleSaveKnowledgeText}
              variant={isDirty ? "primary" : "secondary"}
            >
              {isSavingText ? "Saving…" : isDirty ? "Save Changes" : "Saved"}
            </Button>
          </div>
        </div>

        <p className="mb-4 text-[14px] leading-relaxed text-dim">
          This knowledge block is injected directly into <code className="font-mono text-xs bg-line-2 px-1 py-0.5 rounded text-fg">&#123;&#123;kb&#125;&#125;</code> on all outbound and test calls. You can edit, tweak, or add extra bullet points at any time.
        </p>

        <Field
          as="textarea"
          className="min-h-[320px] font-mono text-[13px] leading-relaxed"
          onChange={(e) => setKbText(e.target.value)}
          placeholder={
            "No knowledge extracted yet. Enter your website above and click 'Extract Knowledge', or paste your brokerage overview here directly."
          }
          rows={16}
          value={kbText}
        />
      </div>

      {/* SECTION 3: FILE UPLOAD DROP ZONE */}
      <div className="az-eyebrow mb-3 block">
        SUPPLEMENTARY DOCUMENTS & BROCHURES
      </div>
      <p className="mb-4 text-[14px] text-dim">
        Attach PDF price lists, floor plans, and brochures for your WhatsApp Copilot.
      </p>

      <Drop
        accept={KB_ACCEPT}
        className="mb-8"
        hint="Price lists, payment plans, brochures. PDF, TXT, MD, CSV, PNG, or JPG. Up to 20 MB."
        onFiles={(files) => upload(files).catch((err) => setError(err.message))}
      >
        Drop supplementary files here
      </Drop>

      <div className="az-eyebrow mb-3 block">
        IN THE KNOWLEDGE BASE · {docs?.length ?? "…"}
      </div>
      <div className="border-t border-line">
        {docs == null ? (
          <>
            <div className="az-row h-[74px]" />
            <div className="az-row h-[74px]" />
          </>
        ) : docs.length === 0 ? (
          <p className="py-8 text-[15px] text-dim">
            No supplementary files uploaded yet.
          </p>
        ) : (
          docs.map((doc) => (
            <div
              className="flex flex-wrap items-center gap-4 border-b border-hairline px-1 py-4.5"
              key={doc.id}
            >
              <span className="w-11 font-mono text-[11px] text-ghost">
                {fileType(doc.filename)}
              </span>
              <div className="min-w-[200px] flex-1">
                <div className="text-base text-fg">{doc.filename}</div>
                <div className="mt-1 text-[13px] text-faint">
                  {doc.index_status} · {fileSize(doc.bytes)}
                </div>
              </div>
              {doc.inherited ? <Pill tone="live">Inherited</Pill> : null}
              {doc.mine && doc.scope === "private" ? (
                <button
                  className="text-sm text-faint hover:text-fg disabled:opacity-40"
                  disabled={busyId === doc.id}
                  onClick={() => act(doc.id, { scope: "tenant" })}
                  type="button"
                >
                  Share with team
                </button>
              ) : null}
              {doc.mine && doc.scope === "tenant" ? (
                <button
                  className="text-sm text-faint hover:text-fg disabled:opacity-40"
                  disabled={busyId === doc.id}
                  onClick={() => act(doc.id, { scope: "private" })}
                  type="button"
                >
                  Make private
                </button>
              ) : null}
              {doc.inherited ? (
                <button
                  className="text-sm text-faint hover:text-fg disabled:opacity-40"
                  disabled={busyId === doc.id}
                  onClick={() => act(doc.id, { hide: true })}
                  type="button"
                >
                  Hide
                </button>
              ) : null}
              {doc.mine && confirmId !== doc.id ? (
                <button
                  className="text-sm text-faint hover:text-fg disabled:opacity-40"
                  disabled={busyId === doc.id}
                  onClick={() => setConfirmId(doc.id)}
                  type="button"
                >
                  Delete
                </button>
              ) : null}
              {doc.mine && confirmId === doc.id ? (
                <span className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-dim">Delete this file?</span>
                  <button
                    className="text-sm text-[#e08b8b] disabled:opacity-40"
                    disabled={busyId === doc.id}
                    onClick={() => remove(doc.id)}
                    type="button"
                  >
                    {busyId === doc.id ? "Deleting…" : "Delete file"}
                  </button>
                  <button
                    className="text-sm text-faint hover:text-fg"
                    disabled={busyId === doc.id}
                    onClick={() => setConfirmId("")}
                    type="button"
                  >
                    Keep
                  </button>
                </span>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="mt-11 rounded-xl border border-line-2 bg-panel px-6 py-5.5 text-[15px] leading-relaxed text-fg-2">
        Try it now: text{" "}
        <span className="font-mono text-az">
          what developers does Stage Properties work with?
        </span>{" "}
        and see how the AI answers from your knowledge base.
      </div>
    </ConsoleShell>
  );
}
