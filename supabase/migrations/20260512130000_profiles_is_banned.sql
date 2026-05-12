-- Ban flags used by admin members API and player search filters.
alter table public.profiles add column if not exists is_banned boolean not null default false;
alter table public.profiles add column if not exists ban_reason text;

comment on column public.profiles.is_banned is 'When true, player is banned from pickup and related flows.';
comment on column public.profiles.ban_reason is 'Optional staff note when is_banned is true.';
