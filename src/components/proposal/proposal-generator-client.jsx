"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "az_proposal_agent_v1";

function loadSavedAgent() {
  if (typeof window === "undefined") return { name: "", company: "", phone: "" };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { name: "", company: "", phone: "" };
    const parsed = JSON.parse(raw);
    return {
      name: String(parsed?.name || ""),
      company: String(parsed?.company || ""),
      phone: String(parsed?.phone || ""),
    };
  } catch {
    return { name: "", company: "", phone: "" };
  }
}

function saveAgent(agent) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        name: agent.name || "",
        company: agent.company || "",
        phone: agent.phone || "",
      })
    );
  } catch {
    // ignore quota / private mode
  }
}

function formatSpecs({ bedrooms, bathrooms, sizeSqft, propertyType }) {
  const parts = [];
  if (bedrooms !== null && bedrooms !== undefined && bedrooms !== "") {
    parts.push(`${bedrooms} bed`);
  }
  if (bathrooms !== null && bathrooms !== undefined && bathrooms !== "") {
    parts.push(`${bathrooms} bath`);
  }
  if (sizeSqft) {
    const n = Number(sizeSqft);
    parts.push(
      `${Number.isFinite(n) ? Math.round(n).toLocaleString() : sizeSqft} sq ft`
    );
  }
  if (propertyType) parts.push(propertyType);
  return parts.join(" · ");
}

function buildFactRows(listing) {
  if (!listing) return [];
  // Useful buyer facts only — price/location already sit in the hero.
  return [
    ["Furnishing", listing.furnishing],
    ["Parking", listing.parking],
    ["Service charge", listing.serviceCharge],
    ["Floor", listing.floor],
    ["View", listing.view],
    ["Status", listing.completionStatus],
    ["Developer", listing.developer],
    ["Year built", listing.yearBuilt],
    ["Ownership", listing.ownership],
    ["Payment plan", listing.paymentPlan],
    ["Building", listing.building],
  ].filter(([, value]) => Boolean(String(value || "").trim()));
}

function usefulHighlights(listing) {
  const blocked = /aed|price|dubai marina|jumeirah|downtown|business bay|jvc|jlt|palm|great location|prime location|ideal investment|perfect for|must see|rare opportunity/i;
  const community = String(listing?.community || "").trim();
  return (listing?.highlights || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      if (blocked.test(item)) return false;
      if (community && item.toLowerCase().includes(community.toLowerCase())) {
        return false;
      }
      return true;
    })
    .slice(0, 6);
}

function slugifyFilename(parts) {
  return parts
    .filter(Boolean)
    .join("_")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
}

function EditableField({
  value,
  onChange,
  className = "",
  multiline = false,
  placeholder = "",
}) {
  const shared = `w-full bg-transparent outline-none focus:ring-1 focus:ring-[#6fd38f]/50 rounded-md ${className}`;
  if (multiline) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={placeholder}
        className={`${shared} resize-none`}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={shared}
    />
  );
}

export default function ProposalGeneratorClient() {
  const previewRef = useRef(null);
  const [url, setUrl] = useState("");
  const [agentName, setAgentName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [agentPhone, setAgentPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [listing, setListing] = useState(null);

  useEffect(() => {
    const saved = loadSavedAgent();
    setAgentName(saved.name);
    setCompanyName(saved.company);
    setAgentPhone(saved.phone);
  }, []);

  const specs = useMemo(
    () => (listing ? formatSpecs(listing) : ""),
    [listing]
  );
  const factRows = useMemo(() => buildFactRows(listing), [listing]);
  const highlights = useMemo(() => usefulHighlights(listing), [listing]);

  async function handleGenerate(event) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError("");
    setListing(null);

    const payload = {
      url: url.trim(),
      agentName: agentName.trim(),
      companyName: companyName.trim(),
      agentPhone: agentPhone.trim(),
    };
    saveAgent(payload);

    try {
      const res = await fetch("/api/proposal-generator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Could not generate the one-pager.");
      }
      setListing({
        ...data.listing,
        agentName: data.agent?.name || payload.agentName,
        companyName: data.agent?.company || payload.companyName,
        agentPhone: data.agent?.phone || payload.agentPhone || "",
      });
    } catch (err) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadPdf() {
    if (!listing || !previewRef.current || downloading) return;
    setDownloading(true);
    setError("");

    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      const canvas = await html2canvas(previewRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#ffffff",
        logging: false,
      });

      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      pdf.addImage(imgData, "JPEG", 0, 0, pageWidth, pageHeight);

      const beds =
        listing.bedrooms !== null && listing.bedrooms !== undefined
          ? `${listing.bedrooms}BR`
          : "";
      const filename =
        slugifyFilename([
          listing.community || "Property",
          beds,
          "one_pager",
        ]) || "AgentZero_one_pager";
      pdf.save(`${filename}.pdf`);
    } catch (err) {
      setError(err?.message || "Could not create the PDF. Try again.");
    } finally {
      setDownloading(false);
    }
  }

  function updateListing(patch) {
    setListing((current) => (current ? { ...current, ...patch } : current));
  }

  const hero = listing?.images?.[0] || null;
  const gallery = (listing?.images || []).slice(1, 4);

  return (
    <main className="min-h-screen bg-[#0c0c0c] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
          <Link href="/" aria-label="AgentZero home">
            <Image
              src="/brand/agentzero-lockup-horizontal.svg"
              alt="AgentZero"
              width={417}
              height={88}
              priority
              unoptimized
              className="h-6 w-auto sm:h-7"
            />
          </Link>
          <Link
            href="/"
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/75 transition hover:border-white/30 hover:text-white"
          >
            Back home
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[0.95fr_1.05fr] lg:items-start lg:gap-10">
        <section>
          <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-[#6fd38f]">
            Free tool · One-pager
          </p>
          <h1 className="mt-3 text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Turn any listing link into a buyer-ready one-pager
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-white/65">
            Paste a Property Finder or Bayut link. We scrape the listing, pull
            the photos, and build a clean PDF with your name and company on it.
          </p>

          <form
            onSubmit={handleGenerate}
            className="mt-8 space-y-4 rounded-[24px] border border-white/10 bg-white/[0.03] p-5 sm:p-6"
          >
            <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-white/70">
              Listing URL
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.propertyfinder.ae/en/plp/..."
                className="mt-2 block w-full rounded-2xl border border-white/15 bg-black/60 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#6fd38f]"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-white/70">
                Your name
                <input
                  type="text"
                  required
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="Alex Mercer"
                  className="mt-2 block w-full rounded-2xl border border-white/15 bg-black/60 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#6fd38f]"
                />
              </label>
              <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-white/70">
                Agency / company
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Sterling Boulevard"
                  className="mt-2 block w-full rounded-2xl border border-white/15 bg-black/60 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#6fd38f]"
                />
              </label>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-white/70">
              WhatsApp / phone{" "}
              <span className="normal-case tracking-normal text-white/40">
                (optional)
              </span>
              <input
                type="text"
                value={agentPhone}
                onChange={(e) => setAgentPhone(e.target.value)}
                placeholder="+971 50 000 0000"
                className="mt-2 block w-full rounded-2xl border border-white/15 bg-black/60 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#6fd38f]"
              />
            </label>

            {error ? (
              <p className="rounded-2xl border border-[#ff2d55]/40 bg-[#ff2d55]/10 px-4 py-3 text-sm text-[#ff9ab0]">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex w-full items-center justify-center rounded-full bg-[#6fd38f] px-6 py-3.5 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
            >
              {loading ? "Scraping listing…" : "Generate one-pager"}
            </button>
            <p className="text-center text-xs text-white/45">
              Takes ~10–20 seconds. Name and company are remembered on this
              device.
            </p>
          </form>
        </section>

        <section className="space-y-4">
          {!listing && !loading ? (
            <div className="flex min-h-[420px] items-center justify-center rounded-[24px] border border-dashed border-white/15 bg-white/[0.02] px-6 text-center">
              <div>
                <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-white/40">
                  Preview
                </p>
                <p className="mt-3 text-sm leading-6 text-white/55">
                  Your branded one-pager will appear here. Click any text in the
                  preview to edit before downloading.
                </p>
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-[24px] border border-white/10 bg-white/[0.03] px-6 text-center">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#6fd38f]/30 border-t-[#6fd38f]" />
              <p className="text-sm text-white/70">
                Pulling photos and details with Firecrawl…
              </p>
            </div>
          ) : null}

          {listing ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-white/60">
                  Tip: click title, price, or summary to tweak before download.
                </p>
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={downloading}
                  className="inline-flex items-center justify-center rounded-full bg-[#6fd38f] px-5 py-2.5 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
                >
                  {downloading ? "Building PDF…" : "Download one-pager PDF"}
                </button>
              </div>

              <div className="overflow-auto rounded-[20px] border border-white/10 bg-[#111] p-3 sm:p-4">
                <div
                  ref={previewRef}
                  className="mx-auto w-full max-w-[794px] overflow-hidden bg-white text-[#111]"
                  style={{
                    aspectRatio: "210 / 297",
                    fontFamily:
                      "var(--font-sans), 'DM Sans', system-ui, sans-serif",
                  }}
                >
                  <div className="flex h-full flex-col">
                    <div className="relative h-[42%] min-h-0 bg-[#1e2c3c]">
                      {hero ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={hero}
                          alt=""
                          crossOrigin="anonymous"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-white/60">
                          No listing photo found
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-6 pb-5 pt-16">
                        <EditableField
                          value={listing.community || ""}
                          onChange={(value) =>
                            updateListing({ community: value.toUpperCase() })
                          }
                          placeholder="AREA"
                          className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-[#6fd38f]"
                        />
                        <EditableField
                          value={listing.price || ""}
                          onChange={(value) => updateListing({ price: value })}
                          placeholder="AED 0"
                          className="mt-1 text-3xl font-semibold tracking-tight text-white"
                        />
                      </div>
                    </div>

                    {gallery.length > 0 ? (
                      <div className="grid grid-cols-3 gap-1 bg-white px-1 pt-1">
                        {gallery.map((src) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={src}
                            src={src}
                            alt=""
                            crossOrigin="anonymous"
                            className="h-20 w-full object-cover sm:h-24"
                          />
                        ))}
                      </div>
                    ) : null}

                    <div className="flex flex-1 flex-col px-6 py-5">
                      <EditableField
                        value={listing.title || ""}
                        onChange={(value) => updateListing({ title: value })}
                        placeholder="Property title"
                        className="text-xl font-semibold leading-snug text-[#111]"
                      />
                      <p className="mt-2 text-sm text-[#555]">
                        {specs || "Specs unavailable"}
                      </p>

                      {factRows.length ? (
                        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-y border-[#ececec] py-3">
                          {factRows.slice(0, 8).map(([label, value]) => (
                            <div key={label} className="min-w-0">
                              <p className="text-[10px] uppercase tracking-[0.14em] text-[#888]">
                                {label}
                              </p>
                              <p className="truncate text-[12.5px] font-medium text-[#222]">
                                {value}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      <EditableField
                        multiline
                        value={listing.summary || ""}
                        onChange={(value) => updateListing({ summary: value })}
                        placeholder="Useful buyer notes (view, parking, layout — not price/area)"
                        className="mt-3 text-[13px] leading-5 text-[#333]"
                      />

                      {highlights.length ? (
                        <ul className="mt-3 space-y-1 text-[12.5px] leading-5 text-[#333]">
                          {highlights.map((item, index) => (
                            <li key={`${item}-${index}`} className="flex gap-2">
                              <span className="mt-[6px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#6fd38f]" />
                              <input
                                type="text"
                                value={item}
                                onChange={(e) => {
                                  const source = listing.highlights || [];
                                  const next = [...source];
                                  const sourceIndex = source.indexOf(item);
                                  if (sourceIndex >= 0) {
                                    next[sourceIndex] = e.target.value;
                                  }
                                  updateListing({ highlights: next });
                                }}
                                className="w-full bg-transparent outline-none focus:ring-1 focus:ring-[#6fd38f]/40 rounded"
                              />
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      {Array.isArray(listing.nearby) && listing.nearby.length ? (
                        <p className="mt-3 text-[12px] leading-5 text-[#555]">
                          <span className="font-semibold text-[#222]">Nearby: </span>
                          {listing.nearby.join(" · ")}
                        </p>
                      ) : null}

                      {Array.isArray(listing.amenities) &&
                      listing.amenities.length ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {listing.amenities.slice(0, 8).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full border border-[#e5e5e5] px-2 py-0.5 text-[10.5px] text-[#444]"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      <div className="mt-auto border-t border-[#ececec] pt-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#6fd38f] text-sm font-semibold text-black">
                              {(listing.agentName || "A").slice(0, 1).toUpperCase()}
                            </span>
                            <div className="min-w-0">
                              <EditableField
                                value={listing.agentName || ""}
                                onChange={(value) =>
                                  updateListing({ agentName: value })
                                }
                                className="text-sm font-semibold text-[#111]"
                              />
                              <EditableField
                                value={listing.companyName || ""}
                                onChange={(value) =>
                                  updateListing({ companyName: value })
                                }
                                className="text-xs text-[#666]"
                              />
                              {listing.agentPhone ? (
                                <p className="text-xs text-[#888]">
                                  {listing.agentPhone}
                                </p>
                              ) : null}
                            </div>
                          </div>
                          <p className="flex-shrink-0 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.16em] text-[#999]">
                            AgentZero
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}
