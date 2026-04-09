import PageTop from "@/components/PageTop";
import { AdminWorkArea } from "@/components/admin/AdminWorkArea";
import { StatusChip } from "@/components/admin/StatusChip";
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

type RegistrationRow = {
  id: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  tournament_id: string;
  esports_player_profile_id: string | null;
  signed_full_name: string;
  consent_recorded_at: string;
  doc_version_official_rules: string;
  doc_version_terms: string;
  doc_version_privacy_publicity: string;
  payment_status: string;
  paid_at: string | null;
  auth_email: string | null;
  player:
    | {
    legal_name: string;
    contact_email: string;
    state: string;
    platform: string;
    psn_id: string | null;
    xbox_gamertag: string | null;
    ea_account: string | null;
    affirmed_18_plus: boolean;
    date_of_birth: string | null;
      }
    | { legal_name: string; contact_email: string; state: string; platform: string; psn_id: string | null; xbox_gamertag: string | null; ea_account: string | null; affirmed_18_plus: boolean; date_of_birth: string | null }[]
    | null;
  tournament: { title: string } | { title: string }[] | null;
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

  const { data: regs, error: regErr } = await svc
    .from("esports_tournament_registrations")
    .select(
      "id,created_at,updated_at,user_id,tournament_id,esports_player_profile_id,signed_full_name,consent_recorded_at,doc_version_official_rules,doc_version_terms,doc_version_privacy_publicity,payment_status,paid_at,auth_email, player:esports_player_profiles(legal_name,contact_email,state,platform,psn_id,xbox_gamertag,ea_account,affirmed_18_plus,date_of_birth), tournament:esports_tournaments(title)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const list = (rows || []) as Row[];
  const registrations = (regs || []) as unknown as RegistrationRow[];

  const liveCount = list.filter((r) => r.status === "upcoming" || r.status === "active").length;

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl space-y-10 py-10">
        <PageTop flush title="Staff · Esports" fallbackHref={APP_HOME_URL} />

        <AdminWorkArea question="Which digital tournaments are upcoming or live on the public listing, and what still needs dates or copy?">
          <div className="mb-2 flex flex-wrap gap-2">
            <StatusChip tone="neutral">{list.length} tournaments</StatusChip>
            <StatusChip tone="published">{liveCount} public-visible</StatusChip>
            <a href="/esports/tournaments" target="_blank" rel="noreferrer" className="text-xs text-white/50 hover:text-white">
              Preview listing ↗
            </a>
          </div>
        </AdminWorkArea>

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
        {regErr ? (
          <p className="text-sm text-red-300">{regErr.message}</p>
        ) : null}

        <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold uppercase tracking-tight text-white">
            Create esports tournament
          </h2>
          <p className="text-sm text-white/55">
            Use a full date and time with timezone, e.g.{" "}
            <code className="text-white/75">2026-05-15T19:00:00-04:00</code>. The public
            listing only shows tournaments marked <span className="text-white/80">upcoming</span> or{" "}
            <span className="text-white/80">active</span>.
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

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white/45">
            Tournament registrations (latest 200)
          </h2>
          {registrations.length === 0 ? (
            <p className="text-sm text-white/50">No registration rows yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03]">
              <table className="min-w-[1100px] w-full text-left text-xs">
                <thead className="border-b border-white/10 text-white/55">
                  <tr>
                    <th className="px-4 py-3">Tournament</th>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Name / Email</th>
                    <th className="px-4 py-3">Platform IDs</th>
                    <th className="px-4 py-3">State</th>
                    <th className="px-4 py-3">Eligibility</th>
                    <th className="px-4 py-3">Consent</th>
                    <th className="px-4 py-3">Payment</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {registrations.map((r) => {
                    const p = Array.isArray(r.player) ? r.player[0] : r.player;
                    const t = Array.isArray(r.tournament) ? r.tournament[0] : r.tournament;
                    const eligibility = p
                      ? p.affirmed_18_plus || !!p.date_of_birth
                        ? "18+ on file"
                        : "missing"
                      : "missing profile";
                    const consentOk = !!r.consent_recorded_at;
                    const pay = r.payment_status;
                    return (
                      <tr key={r.id} className="text-white/80">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-white/90">
                            {t?.title || r.tournament_id}
                          </div>
                          <div className="text-[10px] text-white/40">{r.tournament_id}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-mono text-[11px] text-white/70">{r.user_id}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-white/90">{p?.legal_name || r.signed_full_name}</div>
                          <div className="text-[11px] text-white/50">
                            {p?.contact_email || r.auth_email || "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-[11px] text-white/70">{p?.platform || "—"}</div>
                          <div className="text-[11px] text-white/55">
                            {p?.platform === "playstation" ? `PSN: ${p.psn_id || "—"}` : null}
                            {p?.platform === "xbox" ? `Xbox: ${p.xbox_gamertag || "—"}` : null}
                          </div>
                          <div className="text-[11px] text-white/55">
                            EA: {p?.ea_account || "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3">{p?.state || "—"}</td>
                        <td className="px-4 py-3">
                          <StatusChip tone={eligibility === "18+ on file" ? "published" : "neutral"}>
                            {eligibility}
                          </StatusChip>
                        </td>
                        <td className="px-4 py-3">
                          <StatusChip tone={consentOk ? "published" : "neutral"}>
                            {consentOk ? "signed" : "missing"}
                          </StatusChip>
                          <div className="text-[10px] text-white/40 mt-1">
                            {r.doc_version_official_rules} / {r.doc_version_terms} / {r.doc_version_privacy_publicity}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusChip
                            tone={pay === "paid" ? "published" : pay === "checkout_started" ? "neutral" : "neutral"}
                          >
                            {pay}
                          </StatusChip>
                          <div className="text-[10px] text-white/40 mt-1">{r.paid_at ? fmtEt(r.paid_at) : ""}</div>
                        </td>
                        <td className="px-4 py-3 text-white/55">{fmtEt(r.created_at)}</td>
                        <td className="px-4 py-3 text-white/55">{fmtEt(r.updated_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
