alter table public.tournament_consents
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.tournament_consents
  add column if not exists auth_email text;

create index if not exists tournament_consents_user_id_idx
  on public.tournament_consents (user_id);
