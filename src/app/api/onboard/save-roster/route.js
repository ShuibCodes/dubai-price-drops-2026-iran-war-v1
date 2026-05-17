import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function normalizeAgent(raw, index) {
  const a = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const id =
    typeof a.id === "string" && a.id.trim()
      ? a.id.trim()
      : `agent_${String(index + 1).padStart(3, "0")}`;

  return {
    id,
    name: typeof a.name === "string" ? a.name : "",
    whatsapp: typeof a.whatsapp === "string" ? a.whatsapp : "",
    role: typeof a.role === "string" ? a.role : "agent",
    gmailToken: "gmailToken" in a ? a.gmailToken : null,
    gmailEmail: "gmailEmail" in a ? a.gmailEmail : null,
    kbFiles: Array.isArray(a.kbFiles) ? a.kbFiles : [],
    lastGmailSync: "lastGmailSync" in a ? a.lastGmailSync : null,
  };
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body?.brokerage !== "string") {
    return NextResponse.json(
      { error: "brokerage must be a string" },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.agents)) {
    return NextResponse.json(
      { error: "agents must be an array" },
      { status: 400 }
    );
  }

  const payload = {
    brokerage: body.brokerage,
    agents: body.agents.map((agent, i) => normalizeAgent(agent, i)),
  };

  const filePath = path.join(process.cwd(), "data", "agents.json");

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to save roster",
      },
      { status: 500 }
    );
  }
}
