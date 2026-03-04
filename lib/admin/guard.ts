import { NextResponse } from "next/server";

export function requireAdmin(req: Request) {
  const expected = process.env.ADMIN_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "Missing ADMIN_SECRET env var" }, { status: 500 });
  }

  const got = req.headers.get("x-admin-secret");
  if (!got || got !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null; // ok
}