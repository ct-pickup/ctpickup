-- Persistent IP rate-limit buckets for public API routes (survives serverless cold starts).

create table if not exists public.api_rate_limit_buckets (
  bucket_key text primary key,
  hit_count integer not null default 0,
  window_start timestamptz not null default now()
);

create index if not exists api_rate_limit_buckets_window_idx
  on public.api_rate_limit_buckets (window_start);

alter table public.api_rate_limit_buckets enable row level security;

-- Service role only (no client policies).

create or replace function public.api_rate_limit_check(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  row public.api_rate_limit_buckets%rowtype;
  window_interval interval := make_interval(secs => greatest(p_window_seconds, 1));
begin
  select * into row
  from public.api_rate_limit_buckets
  where bucket_key = p_bucket_key
  for update;

  if not found then
    insert into public.api_rate_limit_buckets (bucket_key, hit_count, window_start)
    values (p_bucket_key, 1, now_ts);
    return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
  end if;

  if row.window_start + window_interval <= now_ts then
    update public.api_rate_limit_buckets
    set hit_count = 1, window_start = now_ts
    where bucket_key = p_bucket_key;
    return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
  end if;

  if row.hit_count >= p_limit then
    return jsonb_build_object(
      'allowed', false,
      'retry_after_seconds',
      greatest(
        1,
        ceil(extract(epoch from (row.window_start + window_interval - now_ts)))::integer
      )
    );
  end if;

  update public.api_rate_limit_buckets
  set hit_count = row.hit_count + 1
  where bucket_key = p_bucket_key;

  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end;
$$;

revoke all on function public.api_rate_limit_check(text, integer, integer) from public;
grant execute on function public.api_rate_limit_check(text, integer, integer) to service_role;
