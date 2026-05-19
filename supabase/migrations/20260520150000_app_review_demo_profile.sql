-- App Store review demo account (see APP_REVIEW_NOTES.md at repo root).
-- Ensure auth user exists in Supabase Dashboard: appreview@ctpickup.net

update public.profiles p
set
  approved = true,
  is_admin = false,
  tier = '1a',
  tier_rank = 1,
  nearest_venue = 'New Haven SoccerRoof',
  zip_code = coalesce(nullif(trim(p.zip_code), ''), '06510'),
  first_name = coalesce(nullif(trim(p.first_name), ''), 'App'),
  last_name = coalesce(nullif(trim(p.last_name), ''), 'Review'),
  updated_at = now()
from auth.users u
where p.id = u.id
  and lower(u.email) = 'appreview@ctpickup.net';
