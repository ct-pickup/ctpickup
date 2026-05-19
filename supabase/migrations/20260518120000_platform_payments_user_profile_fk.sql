-- Enable PostgREST embed: platform_payments.user_id -> profiles (LEFT JOIN in admin queries).
alter table public.platform_payments
  add constraint platform_payments_user_id_fkey
  foreign key (user_id) references public.profiles (id);
