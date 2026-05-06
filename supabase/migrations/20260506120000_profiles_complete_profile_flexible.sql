-- Align profiles constraints with mobile complete-profile (gender option, esports UI).

alter table public.profiles drop constraint if exists profiles_gender_check;
alter table public.profiles
  add constraint profiles_gender_check
  check (gender is null or gender in ('male', 'female', 'other', 'prefer_not_to_say'));

comment on column public.profiles.gender is 'male | female | other | prefer_not_to_say (player provided).';

alter table public.profiles drop constraint if exists profiles_esports_platform_check;
alter table public.profiles
  add constraint profiles_esports_platform_check
  check (
    esports_platform is null
    or esports_platform in ('xbox', 'playstation', 'ps5', 'pc')
  );

comment on column public.profiles.esports_platform is 'Console family / PC when esports_interest = yes: xbox | playstation | ps5 | pc.';

alter table public.profiles drop constraint if exists profiles_esports_console_check;

comment on column public.profiles.esports_console is 'Free-text hardware / model label when esports_interest = yes.';
