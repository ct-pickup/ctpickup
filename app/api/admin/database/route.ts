import { NextResponse } from "next/server";
import { fetchAdminDatabaseOverview, fetchAdminDatabaseTable } from "@/lib/admin/database/queries";
import {
  ADMIN_DATABASE_TABLE_KEYS,
  isAdminDatabaseTableKey,
  type AdminDatabaseOverviewResponse,
  type AdminDatabaseTableResponse,
} from "@/lib/admin/database/types";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/database — section overview (counts + last updated).
 * GET /api/admin/database?table=runs — recent rows for one table (admin bearer required).
 */
export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const tableRaw = String(url.searchParams.get("table") || "").trim().toLowerCase();

  const admin = supabaseService();

  if (!tableRaw || tableRaw === "overview") {
    const sections = await fetchAdminDatabaseOverview(admin, [...ADMIN_DATABASE_TABLE_KEYS]);
    const body: AdminDatabaseOverviewResponse = { sections };
    return NextResponse.json(body);
  }

  if (!isAdminDatabaseTableKey(tableRaw)) {
    return NextResponse.json(
      {
        error: `Unknown table. Use one of: ${ADMIN_DATABASE_TABLE_KEYS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  try {
    const { summary, records } = await fetchAdminDatabaseTable(admin, tableRaw);
    const body: AdminDatabaseTableResponse = {
      table: tableRaw,
      total_count: summary.total_count,
      last_updated: summary.last_updated,
      records,
    };
    return NextResponse.json(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[admin/database] table=${tableRaw}:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
