import PageTop from "@/components/PageTop";
import { AdminHubNav } from "@/components/admin/AdminHubNav";
import { APP_HOME_URL } from "@/lib/siteNav";
import { supabaseService } from "@/lib/supabase/service";
import {
  createEsportsTournament,
  deleteEsportsTournament,
  updateEsportsTournament,
} from "./actions";

export const dynamic = "force-dynamic";

function fmtEt(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

type Row = {
  id: string;
  title: string;
  game: string;
  prize: string;
  start_date: string;
  end_date: string;
  status: string;
  description: string | null;
  created_at: string;
};

export default async function AdminEsportsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; e?: string }>;
}) {
  const sp = await searchParams;
  const svc = supabaseService();
  const { data: rows, error } = await svc
    .from("esports_tournaments")
    .select("*")
    .order("start_date", { ascending: true });

  const list = (rows || []) as Row[];

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl space-y-10 px-6 py-10">
        <PageTop flush title="ADMIN · ESPORTS" fallbackHref={APP_HOME_URL} />
        <AdminHubNav />

        {sp.ok ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {sp.ok === "created" && "Esports tournament created."}
            {sp.ok === "saved" && "Esports tournament updated."}
            {sp.ok === "deleted" && "Esports tournament deleted."}
          </div>
        ) : null}
        {sp.e ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {sp.e}
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-red-300">{error.message}</p>
        ) : null}

        <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold uppercase tracking-tight text-white">
            Create esports tournament
          </h2>
          <p className="text-sm text-white/55">
            Use ISO 8601 for dates (include offset or Z), e.g.{" "}
            <code className="text-white/75">2026-05-15T19:00:00-04:00</code>. Public
            page shows tournaments with status{" "}
            <span className="text-white/80">upcoming</span> or{" "}
            <span className="text-white/80">active</span> only.
          </p>
          <form
            action={createEsportsTournament}
            className="grid gap-3 md:grid-cols-2 lg:grid-cols-3"
          >
            <input
              name="title"
              required
              placeholder="Title"
              className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
            />
            <input
              name="game"
              required
              placeholder='Game (e.g. EA SPORTS FC 26)'
              className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
            />
            <input
              name="prize"
              required
              placeholder="Prize"
              className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
            />
            <input
              name="start_date"
              required
              placeholder="Start (ISO 8601)"
              className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
            />
            <input
              name="end_date"
              required
              placeholder="End (ISO 8601)"
              className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
            />
            <select
              name="status"
              className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              defaultValue="upcoming"
            >
              <option value="upcoming">upcoming</option>
              <option value="active">active</option>
              <option value="completed">completed</option>
            </select>
            <textarea
              name="description"
              placeholder="Description (optional)"
              rows={3}
              className="md:col-span-2 lg:col-span-3 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
            />
            <div className="md:col-span-2 lg:col-span-3">
              <button
                type="submit"
                className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black"
              >
                Create
              </button>
            </div>
          </form>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white/45">
            All esports tournaments
          </h2>
          {list.length === 0 ? (
            <p className="text-sm text-white/50">No rows yet.</p>
          ) : (
            <div className="space-y-6">
              {list.map((row) => (
                <div
                  key={row.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
                >
                  <form
                    action={updateEsportsTournament}
                    className="grid gap-3 md:grid-cols-2 lg:grid-cols-3"
                  >
                    <input type="hidden" name="id" value={row.id} />
                    <input
                      name="title"
                      required
                      defaultValue={row.title}
                      className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                    />
                    <input
                      name="game"
                      required
                      defaultValue={row.game}
                      className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                    />
                    <input
                      name="prize"
                      required
                      defaultValue={row.prize}
                      className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                    />
                    <input
                      name="start_date"
                      required
                      defaultValue={row.start_date}
                      className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                    />
                    <input
                      name="end_date"
                      required
                      defaultValue={row.end_date}
                      className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                    />
                    <select
                      name="status"
                      defaultValue={row.status}
                      className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                    >
                      <option value="upcoming">upcoming</option>
                      <option value="active">active</option>
                      <option value="completed">completed</option>
                    </select>
                    <textarea
                      name="description"
                      defaultValue={row.description ?? ""}
                      rows={3}
                      className="md:col-span-2 lg:col-span-3 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                    />
                    <div className="flex flex-wrap gap-2 md:col-span-2 lg:col-span-3">
                      <button
                        type="submit"
                        className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black"
                      >
                        Save changes
                      </button>
                    </div>
                  </form>
                  <p className="mt-3 text-xs text-white/40">
                    Created {fmtEt(row.created_at)} · Start {fmtEt(row.start_date)} · End{" "}
                    {fmtEt(row.end_date)}
                  </p>
                  <form action={deleteEsportsTournament} className="mt-3">
                    <input type="hidden" name="id" value={row.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-200/95 hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
