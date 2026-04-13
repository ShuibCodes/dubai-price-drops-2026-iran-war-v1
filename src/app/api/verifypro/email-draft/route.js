import { NextResponse } from "next/server";
import { buildEmailDraftFromRequest } from "@/lib/email/draft-workflow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  try {
    const draft = await buildEmailDraftFromRequest(message);
    if (draft.missingEmail) {
      return NextResponse.json({
        success: false,
        needsInput: true,
        error: "I found the lead context but no email address. Please provide the recipient email.",
        draft,
      });
    }

    return NextResponse.json({
      success: true,
      draft,
      confirmationPrompt: "Draft ready. Reply yes to send this email.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to build email draft" },
      { status: 502 }
    );
  }
}
