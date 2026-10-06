-- PARTNER-UX-8: one static catalog thumbnail per stage 3D model.
--
-- Storage paths stay off public.vibode_stage_assets. That table is readable
-- by anon/authenticated. This table is service-role only, same as partner
-- asset storage. Thumbnail failure does not change asset status.
--
-- Objects live in the existing private vibode-thumbnails bucket.

begin;

create table public.vibode_stage_model_thumbnails (
  asset_id text primary key
    references public.vibode_stage_assets (asset_id)
    on delete cascade,
  status text not null default 'pending',
  source_sha256 text,
  storage_bucket text,
  storage_path text,
  attempt_count integer not null default 0,
  not_before timestamptz not null default now(),
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  claim_nonce text,
  last_error_code text,
  last_error_message text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vibode_stage_model_thumbnails_status_closed
    check (status in ('pending', 'running', 'ready', 'failed')),
  constraint vibode_stage_model_thumbnails_sha_hex
    check (source_sha256 is null or source_sha256 ~ '^[a-f0-9]{64}$'),
  constraint vibode_stage_model_thumbnails_attempt_bounds
    check (attempt_count >= 0 and attempt_count <= 3),
  constraint vibode_stage_model_thumbnails_error_len
    check (last_error_message is null or char_length(last_error_message) <= 240),
  constraint vibode_stage_model_thumbnails_bucket_closed
    check (storage_bucket is null or storage_bucket = 'vibode-thumbnails'),
  constraint vibode_stage_model_thumbnails_path_safe
    check (
      storage_path is null
      or (
        storage_path ~ '^models/[A-Za-z0-9._/-]{1,480}/[a-f0-9]{64}\.webp$'
        and position('..' in storage_path) = 0
      )
    ),
  constraint vibode_stage_model_thumbnails_ready_complete
    check (
      status <> 'ready'
      or (
        storage_bucket = 'vibode-thumbnails'
        and storage_path is not null
        and source_sha256 is not null
        and generated_at is not null
      )
    )
);

create unique index vibode_stage_model_thumbnails_claim_nonce_uidx
  on public.vibode_stage_model_thumbnails (claim_nonce)
  where claim_nonce is not null;

create index vibode_stage_model_thumbnails_due_idx
  on public.vibode_stage_model_thumbnails (not_before, created_at)
  where status = 'pending';

create trigger set_timestamp_vibode_stage_model_thumbnails
before update on public.vibode_stage_model_thumbnails
for each row execute function public.set_timestamp();

create or replace function public.claim_next_vibode_stage_model_thumbnail()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.vibode_stage_model_thumbnails%rowtype;
  v_nonce text;
begin
  update public.vibode_stage_model_thumbnails
  set status = case when attempt_count >= 3 then 'failed' else 'pending' end,
      last_error_code = case
        when attempt_count >= 3 then 'claim_expired'
        else last_error_code
      end,
      last_error_message = case
        when attempt_count >= 3 then 'Claim lease expired after the last attempt.'
        else last_error_message
      end,
      claim_nonce = null,
      claimed_at = null,
      claim_expires_at = null,
      not_before = now()
  where status = 'running'
    and claim_expires_at is not null
    and claim_expires_at <= now();

  select *
  into v_row
  from public.vibode_stage_model_thumbnails
  where status = 'pending'
    and not_before <= now()
    and attempt_count < 3
    and source_sha256 is not null
  order by not_before, created_at
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'job', null);
  end if;

  v_nonce := gen_random_uuid()::text;

  update public.vibode_stage_model_thumbnails
  set status = 'running',
      attempt_count = attempt_count + 1,
      claimed_at = now(),
      claim_expires_at = now() + interval '180 seconds',
      claim_nonce = v_nonce,
      last_error_code = null,
      last_error_message = null
  where asset_id = v_row.asset_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object(
      'assetId', v_row.asset_id,
      'sourceSha256', v_row.source_sha256,
      'claimNonce', v_row.claim_nonce,
      'claimExpiresAt', v_row.claim_expires_at,
      'attemptCount', v_row.attempt_count
    )
  );
end;
$$;

create or replace function public.fail_vibode_stage_model_thumbnail(
  p_asset_id text,
  p_claim_nonce text,
  p_code text,
  p_message text,
  p_retryable boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.vibode_stage_model_thumbnails%rowtype;
  v_message text;
  v_delay integer;
begin
  select *
  into v_row
  from public.vibode_stage_model_thumbnails
  where asset_id = p_asset_id
    and claim_nonce = p_claim_nonce
    and status = 'running'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_claimed');
  end if;

  v_message := left(btrim(coalesce(p_message, p_code, 'render_page_error')), 240);
  if p_retryable and v_row.attempt_count < 3 then
    v_delay := case v_row.attempt_count
      when 1 then 15
      when 2 then 60
      else 180
    end;
    update public.vibode_stage_model_thumbnails
    set status = 'pending',
        not_before = now() + make_interval(secs => v_delay),
        claim_nonce = null,
        claimed_at = null,
        claim_expires_at = null,
        last_error_code = left(btrim(coalesce(p_code, 'render_page_error')), 80),
        last_error_message = v_message
    where asset_id = v_row.asset_id;
  else
    update public.vibode_stage_model_thumbnails
    set status = 'failed',
        claim_nonce = null,
        claimed_at = null,
        claim_expires_at = null,
        last_error_code = left(btrim(coalesce(p_code, 'render_page_error')), 80),
        last_error_message = v_message
    where asset_id = v_row.asset_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.publish_vibode_stage_model_thumbnail(
  p_asset_id text,
  p_claim_nonce text,
  p_source_sha256 text,
  p_storage_path text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.vibode_stage_model_thumbnails%rowtype;
  v_expected text;
begin
  select *
  into v_row
  from public.vibode_stage_model_thumbnails
  where asset_id = p_asset_id
    and claim_nonce = p_claim_nonce
    and status = 'running'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_claimed');
  end if;

  if v_row.source_sha256 is distinct from p_source_sha256 then
    return jsonb_build_object('ok', false, 'code', 'stale_publish');
  end if;

  v_expected := 'models/' || p_asset_id || '/' || p_source_sha256 || '.webp';
  if p_storage_path is distinct from v_expected
    or position('..' in p_storage_path) > 0
    or p_source_sha256 !~ '^[a-f0-9]{64}$'
  then
    return jsonb_build_object('ok', false, 'code', 'invalid_storage_path');
  end if;

  update public.vibode_stage_model_thumbnails
  set status = 'ready',
      storage_bucket = 'vibode-thumbnails',
      storage_path = v_expected,
      generated_at = now(),
      claim_nonce = null,
      claimed_at = null,
      claim_expires_at = null,
      last_error_code = null,
      last_error_message = null
  where asset_id = v_row.asset_id;

  return jsonb_build_object('ok', true, 'storagePath', v_expected);
end;
$$;

revoke all on table public.vibode_stage_model_thumbnails
  from public, anon, authenticated;
grant select, insert, update, delete on table public.vibode_stage_model_thumbnails
  to service_role;

revoke all on function public.claim_next_vibode_stage_model_thumbnail()
  from public, anon, authenticated;
revoke all on function public.fail_vibode_stage_model_thumbnail(text, text, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.publish_vibode_stage_model_thumbnail(text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.claim_next_vibode_stage_model_thumbnail()
  to service_role;
grant execute on function public.fail_vibode_stage_model_thumbnail(text, text, text, text, boolean)
  to service_role;
grant execute on function public.publish_vibode_stage_model_thumbnail(text, text, text, text)
  to service_role;

alter table public.vibode_stage_model_thumbnails enable row level security;

commit;
