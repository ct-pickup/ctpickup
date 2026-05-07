-- Home / service-area zip (5-digit US) for mobile profile and distance hints.
alter table public.profiles add column if not exists zip_code text;

comment on column public.profiles.zip_code is 'US ZIP code (5 digits) for regional distance estimates.';
