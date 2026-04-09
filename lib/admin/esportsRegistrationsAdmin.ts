import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseService } from "@/lib/supabase/service";

export type EsportsPlayerProfileFields = {
  legal_name: string;
  contact_email: string;
  state: string;
  platform: string;
  psn_id: string | null;
  xbox_gamertag: string | null;
  ea_account: string | null;
  affirmed_18_plus: boolean;
  date_of_birth: string | null;
};

export type EsportsRegistrationAdminRow = {
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
  profile: EsportsPlayerProfileFields | null;
  tournament_title: string | null;
};

export type EsportsRegistrationFilters = {
  tournamentId: string | null;
  paymentStatus: string | null;
  profileLink: "all" | "missing" | "linked";
};

const PROFILE_FIELDS =
  "legal_name,contact_email,state,platform,psn_id,xbox_gamertag,ea_account,affirmed_18_plus,date_of_birth";

const EMBED_SELECT = `
  id,
  created_at,
  updated_at,
  user_id,
  tournament_id,
  esports_player_profile_id,
  signed_full_name,
  consent_recorded_at,
  doc_version_official_rules,
  doc_version_terms,
  doc_version_privacy_publicity,
  payment_status,
  paid_at,
  auth_email,
  esports_player_profiles (${PROFILE_FIELDS}),
  esports_tournaments ( id, title )
`.replace(/\s+/g, " ");

function one<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? (x[0] ?? null) : x;
}

async function fetchWithManualJoin(
  svc: SupabaseClient,
  filters: EsportsRegistrationFilters,
  limit: number,
): Promise<{ rows: EsportsRegistrationAdminRow[]; error: string | null }> {
  let q = svc
    .from("esports_tournament_registrations")
    .select(
      "id,created_at,updated_at,user_id,tournament_id,esports_player_profile_id,signed_full_name,consent_recorded_at,doc_version_official_rules,doc_version_terms,doc_version_privacy_publicity,payment_status,paid_at,auth_email",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filters.tournamentId) {
    q = q.eq("tournament_id", filters.tournamentId);
  }
  if (filters.paymentStatus) {
    q = q.eq("payment_status", filters.paymentStatus);
  }
  if (filters.profileLink === "missing") {
    q = q.is("esports_player_profile_id", null);
  } else if (filters.profileLink === "linked") {
    q = q.not("esports_player_profile_id", "is", null);
  }

  const { data: regs, error: rErr } = await q;
  if (rErr) {
    return { rows: [], error: rErr.message };
  }
  if (!regs?.length) {
    return { rows: [], error: null };
  }

  const profileIds = [
    ...new Set(
      regs.map((r) => r.esports_player_profile_id).filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const tournamentIds = [...new Set(regs.map((r) => r.tournament_id).filter(Boolean))];

  const [{ data: profs, error: pErr }, { data: tours, error: tErr }] = await Promise.all([
    profileIds.length
      ? svc
          .from("esports_player_profiles")
          .select(`id,${PROFILE_FIELDS}`)
          .in("id", profileIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
    tournamentIds.length
      ? svc.from("esports_tournaments").select("id,title").in("id", tournamentIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[], error: null }),
  ]);

  if (pErr) {
    return { rows: [], error: pErr.message };
  }
  if (tErr) {
    return { rows: [], error: tErr.message };
  }

  const profMap = new Map(
    (profs || []).map((p) => [String((p as { id: string }).id), p as EsportsPlayerProfileFields & { id: string }]),
  );
  const tourMap = new Map((tours || []).map((t) => [t.id, t.title]));

  const rows: EsportsRegistrationAdminRow[] = regs.map((r) => {
    const pid = r.esports_player_profile_id as string | null;
    const pRow = pid ? profMap.get(pid) : undefined;
    const profile: EsportsPlayerProfileFields | null = pRow
      ? {
          legal_name: String(pRow.legal_name ?? ""),
          contact_email: String(pRow.contact_email ?? ""),
          state: String(pRow.state ?? ""),
          platform: String(pRow.platform ?? ""),
          psn_id: pRow.psn_id ?? null,
          xbox_gamertag: pRow.xbox_gamertag ?? null,
          ea_account: pRow.ea_account ?? null,
          affirmed_18_plus: !!pRow.affirmed_18_plus,
          date_of_birth: pRow.date_of_birth ?? null,
        }
      : null;

    return {
      id: String(r.id),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
      user_id: String(r.user_id),
      tournament_id: String(r.tournament_id),
      esports_player_profile_id: pid,
      signed_full_name: String(r.signed_full_name),
      consent_recorded_at: String(r.consent_recorded_at),
      doc_version_official_rules: String(r.doc_version_official_rules),
      doc_version_terms: String(r.doc_version_terms),
      doc_version_privacy_publicity: String(r.doc_version_privacy_publicity),
      payment_status: String(r.payment_status),
      paid_at: r.paid_at ? String(r.paid_at) : null,
      auth_email: r.auth_email ? String(r.auth_email) : null,
      profile,
      tournament_title: tourMap.get(r.tournament_id as string) ?? null,
    };
  });

  return { rows, error: null };
}

/**
 * Loads registrations with player profile + tournament title.
 * Tries PostgREST embed first; on schema-cache / relationship errors, falls back to manual joins (same result shape).
 */
export async function fetchEsportsRegistrationsForAdmin(
  filters: EsportsRegistrationFilters,
  limit = 500,
): Promise<{ rows: EsportsRegistrationAdminRow[]; error: string | null; usedFallback: boolean }> {
  const svc = supabaseService();

  let q = svc
    .from("esports_tournament_registrations")
    .select(EMBED_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filters.tournamentId) {
    q = q.eq("tournament_id", filters.tournamentId);
  }
  if (filters.paymentStatus) {
    q = q.eq("payment_status", filters.paymentStatus);
  }
  if (filters.profileLink === "missing") {
    q = q.is("esports_player_profile_id", null);
  } else if (filters.profileLink === "linked") {
    q = q.not("esports_player_profile_id", "is", null);
  }

  const { data, error } = await q;

  if (error) {
    const fb = await fetchWithManualJoin(svc, filters, limit);
    if (fb.error) {
      return {
        rows: [],
        error: `Registration query failed: ${error.message}. Fallback: ${fb.error}`,
        usedFallback: true,
      };
    }
    return { rows: fb.rows, error: null, usedFallback: true };
  }

  const raw = (data || []) as unknown as Array<{
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
    esports_player_profiles: EsportsPlayerProfileFields | EsportsPlayerProfileFields[] | null;
    esports_tournaments: { id: string; title: string } | { id: string; title: string }[] | null;
  }>;

  const rows: EsportsRegistrationAdminRow[] = raw.map((r) => {
    const p = one(r.esports_player_profiles);
    const t = one(r.esports_tournaments);
    return {
      id: r.id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      user_id: r.user_id,
      tournament_id: r.tournament_id,
      esports_player_profile_id: r.esports_player_profile_id,
      signed_full_name: r.signed_full_name,
      consent_recorded_at: r.consent_recorded_at,
      doc_version_official_rules: r.doc_version_official_rules,
      doc_version_terms: r.doc_version_terms,
      doc_version_privacy_publicity: r.doc_version_privacy_publicity,
      payment_status: r.payment_status,
      paid_at: r.paid_at,
      auth_email: r.auth_email,
      profile: p
        ? {
            legal_name: p.legal_name,
            contact_email: p.contact_email,
            state: p.state,
            platform: p.platform,
            psn_id: p.psn_id ?? null,
            xbox_gamertag: p.xbox_gamertag ?? null,
            ea_account: p.ea_account ?? null,
            affirmed_18_plus: !!p.affirmed_18_plus,
            date_of_birth: p.date_of_birth ?? null,
          }
        : null,
      tournament_title: t?.title ?? null,
    };
  });

  return { rows, error: null, usedFallback: false };
}

export async function fetchEsportsTournamentsForAdminFilter(): Promise<
  { id: string; title: string; start_date: string }[]
> {
  const svc = supabaseService();
  const { data, error } = await svc
    .from("esports_tournaments")
    .select("id,title,start_date")
    .order("start_date", { ascending: false });

  if (error || !data) return [];
  return data as { id: string; title: string; start_date: string }[];
}
