-- Distinguish Expo Go (storeClient) tokens from standalone/dev-client builds.
alter table public.user_push_devices
  add column if not exists installation_context text;

comment on column public.user_push_devices.installation_context is
  'expo-constants executionEnvironment when registered: storeClient (Expo Go), standalone (TestFlight/App Store), bare (dev client). Server push targets standalone/bare only.';

create index if not exists user_push_devices_installation_context_idx
  on public.user_push_devices (installation_context);
