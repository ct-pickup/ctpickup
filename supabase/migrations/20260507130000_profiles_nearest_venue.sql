-- Denormalized nearest pickup venue name (from app zip → venue distance logic) for admin filtering in Supabase.
alter table public.profiles add column if not exists nearest_venue text;

comment on column public.profiles.nearest_venue is 'Display name of the closest CT Pickup venue for zip_code; null when zip missing or no estimate.';
