alter table public.tournament_consents
  add column if not exists agreement_title text,
  add column if not exists agreement_text text,
  add column if not exists signed_name text;
