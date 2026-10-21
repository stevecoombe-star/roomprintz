-- REMOVE-2D6: explicit admin retry of a failed Clean Up Room job.
--
-- Review this file before applying it. Do not apply it as part of app
-- startup, and do not apply it to hosted Supabase without explicit approval.
--
-- The failed row stays unchanged. Retry inserts a new queued job that reuses
-- the stored input artifacts and carries a new paid-request fingerprint.
-- Ordinary enqueue idempotency is unchanged. This does not alter AFC tables,
-- Harmonize jobs, thumbnail jobs, room History assets, or 3D scene rows.

begin;

-- NO ACTION, not CASCADE. Deleting a room already deletes every job for that
-- room in one statement. A second cascade from this self-reference can try to
-- delete the same child twice. NO ACTION is checked after the statement.
alter table public.vibode_cleanup_generations
  add column retry_of_job_id uuid null references public.vibode_cleanup_generations(id),
  add column retry_ordinal integer not null default 0;

alter table public.vibode_cleanup_generations
  add constraint vibode_cleanup_retry_ordinal_nonnegative
    check (retry_ordinal >= 0),
  add constraint vibode_cleanup_retry_lineage
    check (
      (retry_of_job_id is null and retry_ordinal = 0)
      or (retry_of_job_id is not null and retry_ordinal > 0)
    );

create index vibode_cleanup_retry_of
  on public.vibode_cleanup_generations (user_id, retry_of_job_id)
  where retry_of_job_id is not null;

comment on column public.vibode_cleanup_generations.retry_of_job_id is
  'Failed job this queued attempt was explicitly retried from. Null on the original attempt.';

create or replace function public.vibode_cleanup_generations_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.user_id is distinct from new.user_id
     or old.room_id is distinct from new.room_id
     or old.afc_generation_id is distinct from new.afc_generation_id
     or old.paid_request_fingerprint is distinct from new.paid_request_fingerprint
     or old.input_fingerprint is distinct from new.input_fingerprint
     or old.original_sha256 is distinct from new.original_sha256
     or old.overlay_sha256 is distinct from new.overlay_sha256
     or old.prompt_sha256 is distinct from new.prompt_sha256
     or old.mask_manifest_sha256 is distinct from new.mask_manifest_sha256
     or old.aspect_ratio_family is distinct from new.aspect_ratio_family
     or old.resolution_class is distinct from new.resolution_class
     or old.original_path is distinct from new.original_path
     or old.overlay_path is distinct from new.overlay_path
     or old.prompt_path is distinct from new.prompt_path
     or old.masks_path is distinct from new.masks_path
     or old.provider is distinct from new.provider
     or old.requested_model_id is distinct from new.requested_model_id
     or old.created_at is distinct from new.created_at
     or old.retry_of_job_id is distinct from new.retry_of_job_id
     or old.retry_ordinal is distinct from new.retry_ordinal
  then
    raise exception 'cleanup snapshot is immutable';
  end if;
  if old.provider_started_at is not null and new.provider_started_at is distinct from old.provider_started_at then
    raise exception 'cleanup provider contact is immutable';
  end if;
  if old.provider_attempt_id is not null and new.provider_attempt_id is distinct from old.provider_attempt_id then
    raise exception 'cleanup provider contact is immutable';
  end if;
  if old.output_sha256 is not null and new.output_sha256 is distinct from old.output_sha256 then
    raise exception 'cleanup output is immutable';
  end if;
  return new;
end;
$$;

create or replace function public.retry_vibode_cleanup_generation(
  p_user_id uuid,
  p_job_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.vibode_cleanup_generations%rowtype;
  v_active public.vibode_cleanup_generations%rowtype;
  v_job public.vibode_cleanup_generations%rowtype;
  v_ordinal integer;
  v_paid text;
begin
  select * into v_source
  from public.vibode_cleanup_generations
  where id = p_job_id
    and user_id = p_user_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_source.status <> 'failed' then
    return jsonb_build_object('ok', false, 'code', 'not_failed');
  end if;

  select * into v_active
  from public.vibode_cleanup_generations
  where user_id = p_user_id
    and retry_of_job_id = p_job_id
    and status in ('queued', 'running')
  order by created_at desc
  limit 1;
  if found then
    return jsonb_build_object('ok', true, 'created', false, 'job', to_jsonb(v_active));
  end if;

  if exists (
    select 1 from public.vibode_cleanup_generations
    where user_id = p_user_id and status in ('queued', 'running')
  ) then
    return jsonb_build_object('ok', false, 'code', 'active_job');
  end if;
  if public.vibode_cleanup_user_provider_started_count(p_user_id) >= public.vibode_cleanup_user_daily_provider_limit() then
    return jsonb_build_object('ok', false, 'code', 'daily_limit');
  end if;
  if public.vibode_cleanup_global_provider_started_count() >= public.vibode_cleanup_global_daily_provider_limit() then
    return jsonb_build_object('ok', false, 'code', 'global_daily_limit');
  end if;

  select coalesce(max(retry_ordinal), 0) + 1 into v_ordinal
  from public.vibode_cleanup_generations
  where retry_of_job_id = p_job_id;
  v_ordinal := greatest(v_source.retry_ordinal + 1, v_ordinal);

  -- Fresh 64-hex key. It includes the source fingerprint, source id, ordinal,
  -- and a new UUID so it cannot collapse onto the failed row. Two md5 values
  -- avoid a pgcrypto dependency. The in-memory double uses SHA-256 plus a UUID.
  v_paid := md5(v_source.paid_request_fingerprint || ':' || v_source.id::text || ':' || v_ordinal::text || ':' || gen_random_uuid()::text)
    || md5(gen_random_uuid()::text || ':' || v_source.id::text);
  if v_paid = v_source.paid_request_fingerprint then
    v_paid := md5(v_paid || gen_random_uuid()::text) || md5(gen_random_uuid()::text);
  end if;

  insert into public.vibode_cleanup_generations (
    id, user_id, room_id, afc_generation_id, paid_request_fingerprint, input_fingerprint,
    status, hidden_object_count, hidden_concepts, selection_summary, original_sha256,
    original_mime, original_byte_count, original_width, original_height, overlay_sha256,
    prompt_sha256, prompt_version, mask_manifest_sha256, aspect_ratio_family,
    documented_1k_grid_width, documented_1k_grid_height, resolution_class, output_mime,
    provider, requested_model_id, artifact_bucket, original_path, overlay_path, prompt_path,
    masks_path, stage_registration, attempt_count, not_before, retry_of_job_id, retry_ordinal
  ) values (
    gen_random_uuid(),
    v_source.user_id,
    v_source.room_id,
    v_source.afc_generation_id,
    v_paid,
    v_source.input_fingerprint,
    'queued',
    v_source.hidden_object_count,
    v_source.hidden_concepts,
    v_source.selection_summary,
    v_source.original_sha256,
    v_source.original_mime,
    v_source.original_byte_count,
    v_source.original_width,
    v_source.original_height,
    v_source.overlay_sha256,
    v_source.prompt_sha256,
    v_source.prompt_version,
    v_source.mask_manifest_sha256,
    v_source.aspect_ratio_family,
    v_source.documented_1k_grid_width,
    v_source.documented_1k_grid_height,
    v_source.resolution_class,
    v_source.output_mime,
    v_source.provider,
    v_source.requested_model_id,
    v_source.artifact_bucket,
    v_source.original_path,
    v_source.overlay_path,
    v_source.prompt_path,
    v_source.masks_path,
    v_source.stage_registration,
    0,
    now(),
    v_source.id,
    v_ordinal
  )
  returning * into v_job;
  return jsonb_build_object('ok', true, 'created', true, 'job', to_jsonb(v_job));
exception
  when unique_violation then
    select * into v_active
    from public.vibode_cleanup_generations
    where user_id = p_user_id
      and retry_of_job_id = p_job_id
      and status in ('queued', 'running')
    order by created_at desc
    limit 1;
    if found then
      return jsonb_build_object('ok', true, 'created', false, 'job', to_jsonb(v_active));
    end if;
    return jsonb_build_object('ok', false, 'code', 'active_job');
end;
$$;

revoke all on function public.retry_vibode_cleanup_generation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.retry_vibode_cleanup_generation(uuid, uuid) to service_role;

commit;
