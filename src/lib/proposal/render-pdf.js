import { jsPDF } from "jspdf";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatSpecs({ bedrooms, bathrooms, sizeSqft, propertyType }) {
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

export function buildFactRows(listing) {
  if (!listing) return [];
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

export function usefulHighlights(listing) {
  const blocked =
    /aed|price|dubai marina|jumeirah|downtown|business bay|jvc|jlt|palm|great location|prime location|ideal investment|perfect for|must see|rare opportunity/i;
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

export function slugifyFilename(parts) {
  return parts
    .filter(Boolean)
    .join("_")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
}

export function buildProposalPdfFilename(listing) {
  const preparedFor = String(listing?.preparedFor || "").trim();
  const beds =
    listing?.bedrooms !== null && listing?.bedrooms !== undefined && listing?.bedrooms !== ""
      ? `${listing.bedrooms}BR`
      : "";
  const base =
    slugifyFilename([
      preparedFor ? `Prepared_for_${preparedFor}` : "",
      listing?.community || "Property",
      beds,
      "one_pager",
    ]) || "AgentZero_one_pager";
  return `${base}.pdf`;
}

async function fetchImageAsDataUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") return null;
  if (imageUrl.startsWith("data:image/")) return imageUrl;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AgentZeroProposalBot/1.0; +https://agentzero.ae)",
        Accept: "image/jpeg,image/png,image/webp,image/*,*/*;q=0.8",
        Referer: new URL(imageUrl).origin,
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return `data:${contentType.split(";")[0]};base64,${base64}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildOnePagerHtml(listing, inlineImages = []) {
  const hero = inlineImages[0] || listing?.images?.[0] || null;
  const gallery = (inlineImages.length ? inlineImages : listing?.images || []).slice(
    1,
    4
  );
  const specs = formatSpecs(listing || {});
  const factRows = buildFactRows(listing).slice(0, 8);
  const highlights = usefulHighlights(listing);
  const nearby = Array.isArray(listing?.nearby) ? listing.nearby.filter(Boolean) : [];
  const amenities = Array.isArray(listing?.amenities)
    ? listing.amenities.filter(Boolean).slice(0, 8)
    : [];
  const preparedFor = String(listing?.preparedFor || "").trim();
  const agentName = String(listing?.agentName || "").trim();
  const companyName = String(listing?.companyName || "").trim();
  const agentPhone = String(listing?.agentPhone || "").trim();
  const footerHeading = preparedFor
    ? `Prepared for ${preparedFor}`
    : agentName || "Property One-Pager";
  const footerSub =
    preparedFor && (agentName || companyName)
      ? [agentName ? `Shared by ${agentName}` : "", companyName]
          .filter(Boolean)
          .join(" · ")
      : companyName;
  const avatarInitial = (preparedFor || agentName || "A").slice(0, 1).toUpperCase();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  @page {
    size: A4 portrait;
    margin: 0;
  }
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  html, body {
    width: 210mm;
    height: 297mm;
    background: #ffffff;
    color: #111111;
    font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    overflow: hidden;
  }
  .page {
    display: flex;
    flex-direction: column;
    width: 210mm;
    height: 297mm;
    overflow: hidden;
    background: #ffffff;
  }
  .hero {
    position: relative;
    height: 42%;
    min-height: 0;
    background: #1e2c3c;
    overflow: hidden;
  }
  .hero img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .hero-empty {
    display: flex;
    height: 100%;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.6);
  }
  .prepared-pill {
    position: absolute;
    top: 18px;
    left: 24px;
    background: rgba(12, 12, 12, 0.78);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(111, 211, 143, 0.45);
    border-radius: 9999px;
    padding: 6px 14px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .prepared-pill-label {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: #6fd38f;
    font-weight: 600;
  }
  .prepared-pill-name {
    font-size: 12.5px;
    font-weight: 600;
    color: #ffffff;
  }
  .hero-overlay {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.62), rgba(0, 0, 0, 0));
    padding: 64px 24px 20px 24px;
  }
  .community {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: #6fd38f;
    font-weight: 600;
  }
  .price {
    margin-top: 4px;
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: #ffffff;
    line-height: 1.15;
  }
  .gallery {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    background: #ffffff;
    padding: 4px 4px 0 4px;
  }
  .gallery img {
    width: 100%;
    height: 92px;
    object-fit: cover;
    display: block;
  }
  .content {
    display: flex;
    flex: 1;
    flex-direction: column;
    padding: 20px 24px;
    min-height: 0;
  }
  .title {
    font-size: 20px;
    font-weight: 600;
    line-height: 1.3;
    color: #111111;
  }
  .specs {
    margin-top: 6px;
    font-size: 13.5px;
    color: #555555;
  }
  .facts {
    margin-top: 12px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 16px;
    row-gap: 6px;
    border-top: 1px solid #ececec;
    border-bottom: 1px solid #ececec;
    padding: 10px 0;
  }
  .fact-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: #888888;
  }
  .fact-value {
    font-size: 12.5px;
    font-weight: 500;
    color: #222222;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .summary {
    margin-top: 12px;
    font-size: 13px;
    line-height: 1.48;
    color: #333333;
  }
  .highlights {
    margin-top: 10px;
    list-style: none;
  }
  .highlights li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12.5px;
    line-height: 1.45;
    color: #333333;
    margin-bottom: 4px;
  }
  .dot {
    margin-top: 6px;
    width: 6px;
    height: 6px;
    border-radius: 9999px;
    background: #6fd38f;
    flex-shrink: 0;
  }
  .nearby {
    margin-top: 10px;
    font-size: 12px;
    line-height: 1.45;
    color: #555555;
  }
  .nearby strong {
    font-weight: 600;
    color: #222222;
  }
  .amenities {
    margin-top: 10px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .amenity {
    border: 1px solid #e5e5e5;
    border-radius: 9999px;
    padding: 2px 9px;
    font-size: 10.5px;
    color: #444444;
  }
  .footer {
    margin-top: auto;
    border-top: 1px solid #ececec;
    padding-top: 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .agent-box {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .avatar {
    width: 40px;
    height: 40px;
    border-radius: 9999px;
    background: #6fd38f;
    color: #000000;
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .agent-name {
    font-size: 14px;
    font-weight: 600;
    color: #111111;
  }
  .agent-company {
    font-size: 12px;
    color: #666666;
  }
  .agent-phone {
    font-size: 12px;
    color: #888888;
  }
  .brand {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: #999999;
    flex-shrink: 0;
  }
</style>
</head>
<body>
  <div class="page">
    <div class="hero">
      ${
        hero
          ? `<img src="${escapeHtml(hero)}" alt="" />`
          : `<div class="hero-empty">No listing photo found</div>`
      }
      ${
        preparedFor
          ? `<div class="prepared-pill">
              <span class="prepared-pill-label">Prepared for</span>
              <span class="prepared-pill-name">${escapeHtml(preparedFor)}</span>
            </div>`
          : ""
      }
      <div class="hero-overlay">
        <div class="community">${escapeHtml(listing?.community || "")}</div>
        <div class="price">${escapeHtml(listing?.price || "")}</div>
      </div>
    </div>

    ${
      gallery.length > 0
        ? `<div class="gallery">${gallery
            .map((src) => `<img src="${escapeHtml(src)}" alt="" />`)
            .join("")}</div>`
        : ""
    }

    <div class="content">
      <div class="title">${escapeHtml(listing?.title || "Property listing")}</div>
      <div class="specs">${escapeHtml(specs || "Specs unavailable")}</div>

      ${
        factRows.length > 0
          ? `<div class="facts">${factRows
              .map(
                ([label, value]) => `
              <div>
                <div class="fact-label">${escapeHtml(label)}</div>
                <div class="fact-value">${escapeHtml(value)}</div>
              </div>`
              )
              .join("")}</div>`
          : ""
      }

      ${
        listing?.summary
          ? `<div class="summary">${escapeHtml(listing.summary)}</div>`
          : ""
      }

      ${
        highlights.length > 0
          ? `<ul class="highlights">${highlights
              .map(
                (item) =>
                  `<li><span class="dot"></span><span>${escapeHtml(item)}</span></li>`
              )
              .join("")}</ul>`
          : ""
      }

      ${
        nearby.length > 0
          ? `<div class="nearby"><strong>Nearby: </strong>${escapeHtml(
              nearby.join(" · ")
            )}</div>`
          : ""
      }

      ${
        amenities.length > 0
          ? `<div class="amenities">${amenities
              .map((tag) => `<span class="amenity">${escapeHtml(tag)}</span>`)
              .join("")}</div>`
          : ""
      }

      <div class="footer">
        <div class="agent-box">
          <div class="avatar">${escapeHtml(avatarInitial)}</div>
          <div>
            <div class="agent-name">${escapeHtml(footerHeading)}</div>
            ${
              footerSub
                ? `<div class="agent-company">${escapeHtml(footerSub)}</div>`
                : ""
            }
            ${
              agentPhone
                ? `<div class="agent-phone">${escapeHtml(agentPhone)}</div>`
                : ""
            }
          </div>
        </div>
        <div class="brand">AgentZero</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

async function launchHeadlessChromium() {
  const { chromium } = await import("playwright");

  if (
    process.platform === "linux" &&
    (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
  ) {
    const sparticuz = (await import("@sparticuz/chromium")).default;
    const executablePath = await sparticuz.executablePath();
    return chromium.launch({
      args: sparticuz.args,
      executablePath,
      headless: true,
    });
  }

  try {
    return await chromium.launch({ headless: true });
  } catch {
    if (process.platform === "darwin") {
      return await chromium.launch({ channel: "chrome", headless: true });
    }
    const sparticuz = (await import("@sparticuz/chromium")).default;
    const executablePath = await sparticuz.executablePath();
    return chromium.launch({
      args: sparticuz.args,
      executablePath,
      headless: true,
    });
  }
}

function renderFallbackJsPdf(listing, inlineImages = []) {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  // Hero background
  doc.setFillColor(30, 44, 60);
  doc.rect(0, 0, 210, 118, "F");

  const hero = inlineImages[0];
  if (hero && /^data:image\/(jpeg|jpg|png)/i.test(hero)) {
    const fmt = /data:image\/png/i.test(hero) ? "PNG" : "JPEG";
    try {
      doc.addImage(hero, fmt, 0, 0, 210, 118, undefined, "FAST");
    } catch {
      // ignore unsupported image encoding in fallback
    }
  }

  const preparedFor = String(listing?.preparedFor || "").trim();
  if (preparedFor) {
    doc.setFillColor(12, 12, 12);
    doc.roundedRect(14, 10, 95, 9, 4, 4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(111, 211, 143);
    doc.text(`PREPARED FOR: ${preparedFor.toUpperCase()}`.slice(0, 38), 18, 15.8);
  }

  // Dark bottom band on hero
  doc.setFillColor(15, 20, 28);
  doc.rect(0, 92, 210, 26, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(111, 211, 143);
  doc.text(String(listing?.community || "PROPERTY").toUpperCase(), 14, 101);

  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text(String(listing?.price || ""), 14, 112);

  let y = 124;
  const gallery = inlineImages.slice(1, 4).filter(Boolean);
  if (gallery.length > 0) {
    const gap = 2;
    const cellW = (210 - 4 - gap * 2) / 3;
    gallery.forEach((img, idx) => {
      if (/^data:image\/(jpeg|jpg|png)/i.test(img)) {
        const fmt = /data:image\/png/i.test(img) ? "PNG" : "JPEG";
        try {
          doc.addImage(img, fmt, 2 + idx * (cellW + gap), 120, cellW, 26, undefined, "FAST");
        } catch {
          // ignore
        }
      }
    });
    y = 154;
  }

  doc.setTextColor(17, 17, 17);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  const titleLines = doc.splitTextToSize(String(listing?.title || "Property listing"), 182);
  doc.text(titleLines.slice(0, 2), 14, y);
  y += titleLines.slice(0, 2).length * 6.5 + 2;

  const specs = formatSpecs(listing || {});
  if (specs) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(85, 85, 85);
    doc.text(specs, 14, y);
    y += 7;
  }

  const factRows = buildFactRows(listing).slice(0, 8);
  if (factRows.length > 0) {
    doc.setDrawColor(236, 236, 236);
    doc.line(14, y, 196, y);
    y += 5;
    for (let i = 0; i < factRows.length; i += 2) {
      const left = factRows[i];
      const right = factRows[i + 1];
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(136, 136, 136);
      doc.text(String(left[0]).toUpperCase(), 14, y);
      if (right) doc.text(String(right[0]).toUpperCase(), 108, y);
      y += 4;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(34, 34, 34);
      doc.text(String(left[1]).slice(0, 38), 14, y);
      if (right) doc.text(String(right[1]).slice(0, 38), 108, y);
      y += 6;
    }
    doc.line(14, y - 2, 196, y - 2);
    y += 4;
  }

  if (listing?.summary) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(51, 51, 51);
    const summaryLines = doc.splitTextToSize(String(listing.summary), 182).slice(0, 4);
    doc.text(summaryLines, 14, y);
    y += summaryLines.length * 4.8 + 3;
  }

  const highlights = usefulHighlights(listing);
  if (highlights.length > 0) {
    highlights.forEach((item) => {
      if (y > 258) return;
      doc.setFillColor(111, 211, 143);
      doc.circle(15.5, y - 1.2, 1, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.2);
      doc.setTextColor(51, 51, 51);
      const lines = doc.splitTextToSize(String(item), 176).slice(0, 2);
      doc.text(lines, 19, y);
      y += lines.length * 4.5 + 1.5;
    });
  }

  // Footer
  doc.setDrawColor(236, 236, 236);
  doc.line(14, 272, 196, 272);
  doc.setFillColor(111, 211, 143);
  doc.circle(20, 281, 5.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  const initial = String(preparedFor || listing?.agentName || "A")
    .slice(0, 1)
    .toUpperCase();
  doc.text(initial, 20, 282.5, { align: "center" });

  doc.setTextColor(17, 17, 17);
  doc.setFontSize(10.5);
  const footerHeading = preparedFor
    ? `Prepared for ${preparedFor}`
    : String(listing?.agentName || "Property One-Pager");
  doc.text(footerHeading, 29, 279);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(102, 102, 102);
  if (listing?.companyName) {
    doc.text(String(listing.companyName), 29, 283.5);
  }
  if (listing?.agentPhone) {
    doc.text(
      String(listing.agentPhone),
      29,
      listing?.companyName ? 287.5 : 283.5
    );
  }

  doc.setFont("courier", "bold");
  doc.setFontSize(8);
  doc.setTextColor(153, 153, 153);
  doc.text("AGENTZERO", 196, 282, { align: "right" });

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}

/**
 * Renders the branded one-pager PDF on the server using headless Chromium
 * (with automatic fallback to jsPDF if Chromium cannot launch).
 */
export async function renderProposalPdfBuffer(listing) {
  const rawImages = Array.isArray(listing?.images) ? listing.images.slice(0, 4) : [];
  const fetchedImages = await Promise.all(rawImages.map(fetchImageAsDataUrl));
  const inlineImages = rawImages.map((original, i) => fetchedImages[i] || original);

  try {
    const browser = await launchHeadlessChromium();
    try {
      const context = await browser.newContext({
        viewport: { width: 794, height: 1123 },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      const html = buildOnePagerHtml(listing, inlineImages);
      await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
      await page.waitForTimeout(250);
      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
        preferCSSPageSize: true,
      });
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (chromiumError) {
    console.warn(
      "[proposal-pdf] Headless Chromium failed, falling back to jsPDF:",
      chromiumError?.message || chromiumError
    );
    return renderFallbackJsPdf(listing, fetchedImages.filter(Boolean));
  }
}
