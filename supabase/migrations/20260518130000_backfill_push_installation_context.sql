-- Legacy rows registered before installation_context was written by the mobile client.
update public.user_push_devices
set installation_context = 'standalone'
where installation_context is null
  and push_notifications_enabled = true;
