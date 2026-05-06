import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const EMPTY_ROSTER = { brokerage: "", agents: [] };

export async function GET() {
  const filePath = path.join(process.cwd(), "data", "agents.json");

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json(EMPTY_ROSTER);
  }
}
