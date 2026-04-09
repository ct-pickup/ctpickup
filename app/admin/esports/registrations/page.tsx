import Link from "next/link";
import PageTop from "@/components/PageTop";
import { StatusChip } from "@/components/admin/StatusChip";
import { APP_HOME_URL } from "@/lib/siteNav";
import {
  fetchEsportsRegistrationsForAdmin,
  fetchEsportsTournamentsForAdminFilter,
} from "@/lib/admin/esportsRegistrationsAdmin";

export const dynamic = "force-dynamic";

function fmtEt(iso: string | null | undefined) {
  if (iso == null || iso === "") return "—";
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
    return String(iso);
  }
}

function eligibilityLabel(p: {
  affirmed_18_plus: boolean;
  date_of_birth: string | null;
} | null): string {
  if (!p) return "— (no profile)";
  if (p.affirmed_18_plus) return "18+ affirmed";
  if (p.date_of_birth) return `DOB: ${p.date_of_birth}`;
  return "incomplete";
}

export default async function AdminEsportsRegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tournament?: string;
    payment?: string;
    profile?: string;
  }>;
}) {
  const sp = await searchParams;
  const tournamentFilter = sp.tournament && sp.tournament !== "all" ? sp.tournament : null;
  const paymentFilter =
    sp.payment && sp.payment !== "all" && ["unpaid", "checkout_started", "paid", "refunded"].includes(sp.payment)
      ? sp.payment
      : null;
  const profileFilter =
    sp.profile === "missing" || sp.profile === "linked" ? sp.profile : "all";

  const [tournaments, result] = await Promise.all([
    fetchEsportsTournamentsForAdminFilter(),
    fetchEsportsRegistrationsForAdmin(
      {
        tournamentId: tournamentFilter,
        paymentStatus: paymentFilter,
        profileLink: profileFilter === "all" ? "all" : profileFilter,
      },
      500,
    ),
  ]);

  const { rows, error, usedFallback } = result;

  const querySummary = (
    <p className="text-xs text-white/45">
      Filters: tournament={tournamentFilter ?? "all"} · payment={paymentFilter ?? "all"} · profile link=
      {profileFilter}
      {usedFallback ? " · loaded via manual join (embed unavailable)" : ""}
    </p>
  );

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-[1600px] space-y-8 px-4 py-10 md:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <PageTop flush title="Staff · Esports registrations" fallbackHref={APP_HOME_URL} />
          <div className="flex flex-wrap gap-2 text-sm">
            <Link
              href="/admin/esports"
              className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 text-white/85 transition hover:bg-white/[0.08]"
            >
              ← Tournament admin
            </Link>
            <a
              href="/esports/tournaments"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-white/15 px-3 py-2 text-white/55 hover:text-white"
            >
              Public listing ↗
            </a>
          </div>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/80">Filters</h2>
          <p className="mt-2 text-sm text-white/55">
            Narrow by tournament, payment state, or whether the registration row is linked to an esports player
            profile.
          </p>
          <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Tournament
              <select
                name="tournament"
                defaultValue={tournamentFilter ?? "all"}
                className="min-w-[200px] rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-sm text-white"
              >
                <option value="all">All tournaments</option>
                {tournaments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Payment status
              <select
                name="payment"
                defaultValue={paymentFilter ?? "all"}
                className="min-w-[180px] rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-sm text-white"
              >
                <option value="all">All</option>
                <option value="unpaid">unpaid</option>
                <option value="checkout_started">checkout_started</option>
                <option value="paid">paid</option>
                <option value="refunded">refunded</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Profile link
              <select
                name="profile"
                defaultValue={profileFilter}
                className="min-w-[200px] rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-sm text-white"
              >
                <option value="all">All</option>
                <option value="linked">Linked to player profile</option>
                <option value="missing">Missing player profile</option>
              </select>
            </label>
            <button
              type="submit"
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
            >
              Apply
            </button>
            <Link
              href="/admin/esports/registrations"
              className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 hover:text-white"
            >
              Reset
            </Link>
          </form>
          {querySummary}
        </section>

        {error ? (
          <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white/45">
              Registrations ({rows.length})
            </h2>
            <StatusChip tone="neutral">Newest first</StatusChip>
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-white/50">No rows match these filters.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
              <table className="min-w-[1400px] w-full border-collapse text-left text-[11px] leading-snug">
                <thead className="sticky top-0 z-10 border-b border-white/10 bg-[#121213] text-[10px] font-semibold uppercase tracking-wider text-white/50">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2.5">Registration ID</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Tournament</th>
                    <th className="whitespace-nowrap px-3 py-2.5">User ID</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Profile ID</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Legal name</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Contact email</th>
                    <th className="whitespace-nowrap px-3 py-2.5">State</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Platform</th>
                    <th className="whitespace-nowrap px-3 py-2.5">PSN</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Xbox</th>
                    <th className="whitespace-nowrap px-3 py-2.5">EA</th>
                    <th className="whitespace-nowrap px-3 py-2.5">18+ / DOB</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Consent</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Doc versions</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Payment</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Paid at</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Created</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top text-white/80 hover:bg-white/[0.02]">
                      <td className="max-w-[120px] px-3 py-2 font-mono text-[10px] text-white/70" title={r.id}>
                        {r.id}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-white/90">{r.tournament_title ?? "—"}</div>
                        <div className="font-mono text-[10px] text-white/35">{r.tournament_id}</div>
                      </td>
                      <td className="max-w-[120px] px-3 py-2 font-mono text-[10px] text-white/65" title={r.user_id}>
                        {r.user_id}
                      </td>
                      <td
                        className="max-w-[120px] px-3 py-2 font-mono text-[10px] text-white/65"
                        title={r.esports_player_profile_id ?? ""}
                      >
                        {r.esports_player_profile_id ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-white/90">{r.profile?.legal_name ?? "—"}</td>
                      <td className="max-w-[140px] break-all px-3 py-2 text-white/70">
                        {r.profile?.contact_email ?? r.auth_email ?? "—"}
                      </td>
                      <td className="px-3 py-2">{r.profile?.state ?? "—"}</td>
                      <td className="px-3 py-2">{r.profile?.platform ?? "—"}</td>
                      <td className="max-w-[100px] break-all px-3 py-2 text-white/70">{r.profile?.psn_id ?? "—"}</td>
                      <td className="max-w-[100px] break-all px-3 py-2 text-white/70">
                        {r.profile?.xbox_gamertag ?? "—"}
                      </td>
                      <td className="max-w-[100px] break-all px-3 py-2 text-white/70">{r.profile?.ea_account ?? "—"}</td>
                      <td className="px-3 py-2 text-white/75">{eligibilityLabel(r.profile)}</td>
                      <td className="px-3 py-2">
                        <StatusChip tone={r.consent_recorded_at ? "published" : "neutral"}>
                          {r.consent_recorded_at ? "recorded" : "—"}
                        </StatusChip>
                        <div className="mt-0.5 text-[10px] text-white/40">{fmtEt(r.consent_recorded_at)}</div>
                        <div className="text-[10px] text-white/35">Signed name: {r.signed_full_name}</div>
                      </td>
                      <td className="max-w-[160px] px-3 py-2 text-[10px] text-white/55">
                        <div>R: {r.doc_version_official_rules}</div>
                        <div>T: {r.doc_version_terms}</div>
                        <div>P: {r.doc_version_privacy_publicity}</div>
                      </td>
                      <td className="px-3 py-2">
                        <StatusChip
                          tone={
                            r.payment_status === "paid"
                              ? "published"
                              : r.payment_status === "checkout_started"
                                ? "neutral"
                                : "neutral"
                          }
                        >
                          {r.payment_status}
                        </StatusChip>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-white/60">{fmtEt(r.paid_at)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-white/60">{fmtEt(r.created_at)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-white/60">{fmtEt(r.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
