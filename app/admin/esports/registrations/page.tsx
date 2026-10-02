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
    <p className="text-caption text-muted">
      Filters: tournament={tournamentFilter ?? "all"} · payment={paymentFilter ?? "all"} · profile link=
      {profileFilter}
      {usedFallback ? " · loaded via manual join (embed unavailable)" : ""}
    </p>
  );

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-[1600px] space-y-8 px-4 py-10 md:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <PageTop flush title="Staff · Esports registrations" fallbackHref={APP_HOME_URL} />
          <div className="flex flex-wrap gap-2 text-small">
            <Link
              href="/admin/esports"
              className="rounded-button border border-line bg-overlay-subtle px-3 py-2 text-ink transition hover:bg-overlay"
            >
              ← Tournament admin
            </Link>
            <a
              href="/esports/tournaments"
              target="_blank"
              rel="noreferrer"
              className="rounded-button border border-line px-3 py-2 text-muted hover:text-ink"
            >
              Public listing ↗
            </a>
          </div>
        </div>

        <section className="rounded-card border border-line bg-overlay-subtle p-5 md:p-6">
          <h2 className="text-small font-semibold text-ink">Filters</h2>
          <p className="mt-2 text-small text-muted">
            Narrow by tournament, payment state, or whether the registration row is linked to an esports player
            profile.
          </p>
          <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-caption text-muted">
              Tournament
              <select
                name="tournament"
                defaultValue={tournamentFilter ?? "all"}
                className="min-w-[200px] rounded-button border border-line bg-overlay-subtle px-3 py-2 text-small text-ink"
              >
                <option value="all">All tournaments</option>
                {tournaments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-caption text-muted">
              Payment status
              <select
                name="payment"
                defaultValue={paymentFilter ?? "all"}
                className="min-w-[180px] rounded-button border border-line bg-overlay-subtle px-3 py-2 text-small text-ink"
              >
                <option value="all">All</option>
                <option value="unpaid">unpaid</option>
                <option value="checkout_started">checkout_started</option>
                <option value="paid">paid</option>
                <option value="refunded">refunded</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-caption text-muted">
              Profile link
              <select
                name="profile"
                defaultValue={profileFilter}
                className="min-w-[200px] rounded-button border border-line bg-overlay-subtle px-3 py-2 text-small text-ink"
              >
                <option value="all">All</option>
                <option value="linked">Linked to player profile</option>
                <option value="missing">Missing player profile</option>
              </select>
            </label>
            <button
              type="submit"
              className="rounded-button bg-pitch px-4 py-2 text-small font-semibold text-on-pitch hover:opacity-90"
            >
              Apply
            </button>
            <Link
              href="/admin/esports/registrations"
              className="rounded-button border border-line px-4 py-2 text-small text-muted hover:text-ink"
            >
              Reset
            </Link>
          </form>
          {querySummary}
        </section>

        {error ? (
          <div className="rounded-card border border-coral bg-overlay-subtle px-4 py-3 text-small text-coral">
            {error}
          </div>
        ) : null}

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-caption font-semibold text-muted">
              Registrations ({rows.length})
            </h2>
            <StatusChip tone="neutral">Newest first</StatusChip>
          </div>

          {rows.length === 0 ? (
            <p className="text-small text-muted">No rows match these filters.</p>
          ) : (
            <div className="overflow-x-auto rounded-card border border-line bg-overlay-subtle">
              <table className="min-w-[1400px] w-full border-collapse text-left text-caption leading-snug">
                <thead className="sticky top-0 z-10 border-b border-line bg-canvas text-caption font-semibold text-muted">
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
                <tbody className="divide-line">
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top text-ink hover:bg-overlay-subtle">
                      <td className="max-w-[120px] px-3 py-2 font-mono text-caption text-muted" title={r.id}>
                        {r.id}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-ink">{r.tournament_title ?? "—"}</div>
                        <div className="font-mono text-caption text-muted">{r.tournament_id}</div>
                      </td>
                      <td className="max-w-[120px] px-3 py-2 font-mono text-caption text-muted" title={r.user_id}>
                        {r.user_id}
                      </td>
                      <td
                        className="max-w-[120px] px-3 py-2 font-mono text-caption text-muted"
                        title={r.esports_player_profile_id ?? ""}
                      >
                        {r.esports_player_profile_id ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-ink">{r.profile?.legal_name ?? "—"}</td>
                      <td className="max-w-[140px] break-all px-3 py-2 text-muted">
                        {r.profile?.contact_email ?? r.auth_email ?? "—"}
                      </td>
                      <td className="px-3 py-2">{r.profile?.state ?? "—"}</td>
                      <td className="px-3 py-2">{r.profile?.platform ?? "—"}</td>
                      <td className="max-w-[100px] break-all px-3 py-2 text-muted">{r.profile?.psn_id ?? "—"}</td>
                      <td className="max-w-[100px] break-all px-3 py-2 text-muted">
                        {r.profile?.xbox_gamertag ?? "—"}
                      </td>
                      <td className="max-w-[100px] break-all px-3 py-2 text-muted">{r.profile?.ea_account ?? "—"}</td>
                      <td className="px-3 py-2 text-muted">{eligibilityLabel(r.profile)}</td>
                      <td className="px-3 py-2">
                        <StatusChip tone={r.consent_recorded_at ? "published" : "neutral"}>
                          {r.consent_recorded_at ? "recorded" : "—"}
                        </StatusChip>
                        <div className="mt-0.5 text-caption text-muted">{fmtEt(r.consent_recorded_at)}</div>
                        <div className="text-caption text-muted">Signed name: {r.signed_full_name}</div>
                      </td>
                      <td className="max-w-[160px] px-3 py-2 text-caption text-muted">
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
                      <td className="whitespace-nowrap px-3 py-2 text-muted">{fmtEt(r.paid_at)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted">{fmtEt(r.created_at)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted">{fmtEt(r.updated_at)}</td>
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
