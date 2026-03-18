import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    const { name, email, whatsapp, area, budget, city } = body;

    if (!name || typeof name !== "string" || name.trim().length < 1) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (!whatsapp || typeof whatsapp !== "string" || whatsapp.trim().length < 5) {
      return NextResponse.json({ error: "WhatsApp number is required" }, { status: 400 });
    }

    const zapierWebhookUrl = process.env.ZAPIER_WEBHOOK_URL;

    if (!zapierWebhookUrl) {
      console.error("ZAPIER_WEBHOOK_URL is not set");
      return NextResponse.json({ error: "Subscription service unavailable" }, { status: 503 });
    }

    const payload = {
      name: name.trim(),
      email: (email ?? "").trim(),
      whatsapp: whatsapp.trim(),
      area: (area ?? "").trim(),
      budget: budget ?? "",
      city: city ?? "",
      timestamp: new Date().toISOString(),
    };

    const zapierResponse = await fetch(zapierWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!zapierResponse.ok) {
      console.error("Zapier webhook failed", zapierResponse.status);
      return NextResponse.json({ error: "Failed to save subscription" }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Subscribe route error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
