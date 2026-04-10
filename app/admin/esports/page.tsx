import Link from "next/link";
import PageTop from "@/components/PageTop";
import { AdminWorkArea } from "@/components/admin/AdminWorkArea";
import { StatusChip } from "@/components/admin/StatusChip";
import { APP_HOME_URL } from "@/lib/siteNav";
import { supabaseService } from "@/lib/supabase/service";
import { isoTimestamptzToEasternDatetimeLocal } from "@/lib/datetime/easternWallTime";
import { EsportsKnockoutBracketEditor } from "@/components/esports/EsportsKnockoutBracketEditor";
import { createEsportsTournament, deleteEsportsTournament, updateEsportsTournament } from "./actions";

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

/** Value for `<input type="datetime-local">` (Eastern wall time, no timezone suffix). */
function easternLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  return isoTimestamptzToEasternDatetimeLocal(iso);
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
  format_summary: string | null;
  group_stage_deadline_1: string | null;
  group_stage_deadline_2: string | null;
  group_stage_final_deadline: string | null;
  knockout_start_at: string | null;
  quarterfinal_deadline: string | null;
  semifinal_deadline: string | null;
  final_deadline: string | null;
  knockout_bracket: unknown | null;
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
      }[]
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

  const { count: regCount, error: regCountErr } = await svc
    .from("esports_tournament_registrations")
    .select("id", { count: "exact", head: true });

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

        <section className="rounded-2xl border border-[var(--brand)]/25 bg-[var(--brand)]/[0.06] p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Tournament registrations</h2>
              <p className="mt-2 max-w-xl text-sm text-white/65">
                View every signup joined to the player&apos;s{" "}
                <span className="text-white/85">esports_player_profiles</span> record (platform IDs,
                contact, eligibility). Filter by tournament, payment, or missing profile link.
              </p>
              <p className="mt-2 text-xs text-white/45">
                {typeof regCount === "number" ? (
                  <>
                    <span className="text-white/70">{regCount}</span> registration row
                    {regCount === 1 ? "" : "s"} in the database.
                  </>
                ) : (
                  "Registration count unavailable."
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusChip tone="neutral">{list.length} tournaments</StatusChip>
              <StatusChip tone="neutral">
                {regCountErr ? "—" : regCount || 0} registrations
              </StatusChip>
            </div>
          </div>
          {regCountErr ? (
            <p className="mt-4 text-sm text-red-200/90">
              {regCountErr.message}
              {regCountErr.message.includes("schema cache") ? (
                <> (Supabase migrations may not be applied in production yet.)</>
              ) : null}
            </p>
          ) : null}
          {regErr ? (
            <p className="mt-2 text-sm text-red-200/90">{regErr.message}</p>
          ) : null}
        </section>

        <AdminWorkArea question="Which digital tournaments are upcoming or live on the public listing, and what still needs dates or copy?">
          <div className="mb-2 flex flex-wrap gap-2">
            <StatusChip tone="neutral">{list.length} tournaments</StatusChip>
            <StatusChip tone="published">{liveCount} public-visible</StatusChip>
            <a
              href="/esports/tournaments"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-white/50 hover:text-white"
            >
              Preview listing ↗
            </a>
          </div>
        </AdminWorkArea>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white/45">
            Tournament registrations (latest 200)
          </h2>
          {registrations.length === 0 ? (
            <p className="text-sm text-white/50">
              {regErr ? "Registrations unavailable (DB issue)." : "No registration rows yet."}
            </p>
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
                          <div className="text-[11px] text-white/55">EA: {p?.ea_account || "—"}</div>
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
                            {r.doc_version_official_rules} / {r.doc_version_terms} /{" "}
                            {r.doc_version_privacy_publicity}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusChip
                            tone={
                              pay === "paid"
                                ? "published"
                                : pay === "checkout_started"
                                  ? "neutral"
                                  : "neutral"
                            }
                          >
                            {pay}
                          </StatusChip>
                          <div className="text-[10px] text-white/40 mt-1">
                            {r.paid_at ? fmtEt(r.paid_at) : ""}
                          </div>
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
            The public listing only shows tournaments marked{" "}
            <span className="text-white/80">upcoming</span> or{" "}
            <span className="text-white/80">active</span>.
          </p>
          <form
            action={createEsportsTournament}
            className="grid gap-3 md:grid-cols-2 lg:grid-cols-3"
          >
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Title
              <input
                name="title"
                required
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Game
              <input
                name="game"
                required
                placeholder="e.g. EA SPORTS FC 26"
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Prize
              <input
                name="prize"
                required
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Tournament starts
              <input
                name="start_date"
                type="datetime-local"
                required
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white [color-scheme:dark]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Tournament ends
              <input
                name="end_date"
                type="datetime-local"
                required
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white [color-scheme:dark]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Status
              <select
                name="status"
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                defaultValue="upcoming"
              >
                <option value="upcoming">upcoming</option>
                <option value="active">active</option>
                <option value="completed">completed</option>
              </select>
            </label>
            <label className="md:col-span-2 lg:col-span-3 flex flex-col gap-1 text-xs text-white/55">
              Description (optional)
              <textarea
                name="description"
                rows={3}
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
              />
            </label>
            <label className="md:col-span-2 lg:col-span-3 flex flex-col gap-1 text-xs text-white/55">
              Public format summary
              <textarea
                name="format_summary"
                rows={3}
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
              />
              <span className="text-[11px] font-normal text-white/45">
                Short simple explanation players will see.
              </span>
            </label>

            <div className="md:col-span-2 lg:col-span-3 space-y-1 border-t border-white/10 pt-4">
              <p className="text-sm font-semibold text-white">Tournament schedule</p>
              <p className="text-xs text-white/55">Enter all times in Eastern Time.</p>
            </div>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Group stage deadline — Monday
              <input
                name="group_stage_deadline_1"
                type="datetime-local"
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white [color-scheme:dark]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Group stage deadline — Tuesday
              <input
                name="group_stage_deadline_2"
                type="datetime-local"
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white [color-scheme:dark]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Group stage final deadline — Wednesday 11:59 PM
              <input
                name="group_stage_final_deadline"
                type="datetime-local"
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white [color-scheme:dark]"
              />
              <span className="text-[11px] font-normal text-white/45">
                Pick the date and 11:59 PM Eastern.
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Knockout starts — Thursday
              <input
                name="knockout_start_at"
                type="datetime-local"
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white [color-scheme:dark]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Quarterfinal deadline
              <input
                name="quarterfinal_deadline"
                type="datetime-local"
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white [color-scheme:dark]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Semifinal deadline
              <input
                name="semifinal_deadline"
                type="datetime-local"
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white [color-scheme:dark]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Final deadline — Sunday 10:30 PM
              <input
                name="final_deadline"
                type="datetime-local"
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white [color-scheme:dark]"
              />
              <span className="text-[11px] font-normal text-white/45">
                Pick the date and 10:30 PM Eastern.
              </span>
            </label>
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
                    <label className="flex flex-col gap-1 text-xs text-white/55">
                      Title
                      <input
                        name="title"
                        required
                        defaultValue={row.title}
                        className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-white/55">
                      Game
                      <input
                        name="game"
                        required
                        defaultValue={row.game}
                        className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-white/55">
                      Prize
                      <input
                        name="prize"
                        required
                        defaultValue={row.prize}
                        className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-white/55">
                      Tournament starts
                      <input
                        name="start_date"
                        type="datetime-local"
                        required
                        defaultValue={easternLocalInputValue(row.start_date)}
                        className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white [color-scheme:dark]"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-white/55">
                      Tournament ends
                      <input
                        name="end_date"
                        type="datetime-local"
                        required
                        defaultValue={easternLocalInputValue(row.end_date)}
                        className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white [color-scheme:dark]"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-white/55">
                      Status
                      <select
                        name="status"
                        defaultValue={row.status}
                        className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                      >
                        <option value="upcoming">upcoming</option>
                        <option value="active">active</option>
                        <option value="completed">completed</option>
                      </select>
                    </label>
                    <label className="md:col-span-2 lg:col-span-3 flex flex-col gap-1 text-xs text-white/55">
                      Description (optional)
                      <textarea
                        name="description"
                        defaultValue={row.description ?? ""}
                        rows={3}
                        className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                      />
                    </label>
                    <label className="md:col-span-2 lg:col-span-3 flex flex-col gap-1 text-xs text-white/55">
                      Public format summary
                      <textarea
                        name="format_summary"
                        defaultValue={row.format_summary ?? ""}
                        rows={3}
                        className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                      />
                      <span className="text-[11px] font-normal text-white/45">
                        Short simple explanation players will see.
                      </span>
                    </label>

                    <div className="md:col-span-2 lg:col-span-3 space-y-1 border-t border-white/10 pt-4">
                      <p className="text-sm font-semibold text-white">Tournament schedule</p>
                      <p className="text-xs text-white/55">Enter all times in Eastern Time.</p>
                    </div>
                    <label className="flex flex-col gap-1 text-xs text-white/55">
                      Group stage deadline — Monday
                      <input
                        name="group_stage_deadline_1"
                        type="datetime-local"
                        defaultValue={easternLocalInputValue(row.group_stage_deadline_1)}
                        className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white [color-scheme:dark]"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-white/55">
                      Group stage deadline — Tuesday
                      <input
                        name="group_stage_deadline_2"
                        type="datetime-local"
                        defaultValue={easternLocalInputValue(row.group_stage_deadline_2)}
                        className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white [color-scheme:dark]"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-white/55">
                      Group stage final deadline — Wednesday 11:59 PM
                      <input
                        name="group_stage_final_deadline"
                        type="datetime-local"
                        defaultValue={easternLocalInputValue(row.group_stage_final_deadline)}
                        className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white [color-scheme:dark]"
                      />
                      <span className="text-[11px] font-normal text-white/45">
                        Pick the date and 11:59 PM Eastern.
                      </span>
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-white/55">
                      Knockout starts — Thursday
                      <input
                        name="knockout_start_at"
                        type="datetime-local"
                        defaultValue={easternLocalInputValue(row.knockout_start_at)}
                        className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white [color-scheme:dark]"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-white/55">
                      Quarterfinal deadline
                      <input
                        name="quarterfinal_deadline"
                        type="datetime-local"
                        defaultValue={easternLocalInputValue(row.quarterfinal_deadline)}
                        className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white [color-scheme:dark]"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-white/55">
                      Semifinal deadline
                      <input
                        name="semifinal_deadline"
                        type="datetime-local"
                        defaultValue={easternLocalInputValue(row.semifinal_deadline)}
                        className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white [color-scheme:dark]"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-white/55">
                      Final deadline — Sunday 10:30 PM
                      <input
                        name="final_deadline"
                        type="datetime-local"
                        defaultValue={easternLocalInputValue(row.final_deadline)}
                        className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white [color-scheme:dark]"
                      />
                      <span className="text-[11px] font-normal text-white/45">
                        Pick the date and 10:30 PM Eastern.
                      </span>
                    </label>
                    <div className="flex flex-wrap gap-2 md:col-span-2 lg:col-span-3">
                      <button
                        type="submit"
                        className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black"
                      >
                        Save changes
                      </button>
                      <Link
                        href={`/admin/esports/tournaments/${row.id}/engine`}
                        className="rounded-md border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/[0.08]"
                      >
                        Tournament engine
                      </Link>
                    </div>
                  </form>
                  <EsportsKnockoutBracketEditor
                    key={row.id}
                    tournamentId={row.id}
                    initialJson={
                      row.knockout_bracket ? JSON.stringify(row.knockout_bracket, null, 2) : ""
                    }
                  />
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
