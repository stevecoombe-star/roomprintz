/**
 * MESHY-1D.4H foreign-key compatibility for the deletion barrier.
 * Disposable Postgres 16. The chain includes D2/D3 and the unapplied barrier
 * migration. Provider calls are not made, and fetch throws.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-account-deletion-1d4h-pg";
const DATABASE = "furniture1d4h";
const BARRIER = "supabase/migrations/20261112180000_vibode_account_deletion_admission.sql";
const FIX = "supabase/migrations/20261112190000_vibode_account_deletion_referential_cleanup.sql";
const GUARD = "supabase/migrations/20261112170000_vibode_furniture_generation_account_deletion_guard.sql";
const BASELINE = [
  "supabase/migrations/20261105180000_vibode_furniture_assets.sql",
  "supabase/migrations/20261106234500_vibode_furniture_generation.sql",
  "supabase/migrations/20261107043000_vibode_furniture_generation_pipeline.sql",
  "supabase/migrations/20261107053000_vibode_furniture_generation_paid_allowance.sql",
  "supabase/migrations/20261107231500_vibode_furniture_generation_one_post.sql",
  "supabase/migrations/20261108110000_vibode_furniture_generation_calibrated_save.sql",
  "supabase/migrations/20261109210000_vibode_furniture_generation_beta_allowances.sql",
  "supabase/migrations/20261109220000_vibode_furniture_generation_beta_allowance_reserve.sql",
  "supabase/migrations/20261110203000_vibode_furniture_generation_beta_allowance_settlement.sql",
  "supabase/migrations/20261110223000_vibode_furniture_generation_processing_slot.sql",
  "supabase/migrations/20261110233000_vibode_furniture_generation_submission_commit.sql",
  "supabase/migrations/20261111003000_vibode_furniture_generation_unreported_credits.sql",
  "supabase/migrations/20261111013000_vibode_furniture_generation_resubmit_budget.sql",
  "supabase/migrations/20261111150000_vibode_furniture_generation_admin_reads.sql",
  "supabase/migrations/20261111170000_vibode_furniture_generation_admin_testers.sql",
  "supabase/migrations/20261111190000_vibode_furniture_generation_cleanup.sql",
  "supabase/migrations/20261111210000_vibode_furniture_generation_owner_allowance.sql",
  "supabase/migrations/20261111220000_vibode_furniture_generation_paid_budget_admission.sql",
  "supabase/migrations/20261112160000_vibode_furniture_generation_owner_recent.sql",
];
const HOSTED_SHAPE = [
  "supabase/migrations/20260316100000_vibode_persistence_foundation.sql",
  "supabase/migrations/20260322153000_vibode_token_accounting_foundation.sql",
  "supabase/migrations/20260525191500_vibode_furniture_collections_v1.sql",
  "supabase/migrations/20261012090000_vibode_harmonize_generations.sql",
  "supabase/migrations/20261013140000_vibode_harmonize_history_publication.sql",
];

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U_MAIN = "11111111-1111-4111-8111-111111111111";
const U_OTHER = "22222222-2222-4222-8222-222222222222";
const U_HOLD = "33333333-3333-4333-8333-333333333333";
const ROOM = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const ROOM_OTHER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc7";
const ROOM_ASSET = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const RUN = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const LEDGER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc4";
const HARMONIZE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc5";
const FURNITURE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc6";
const JOB_DONE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const JOB_HOLD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const JOB_DIRECT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const DRAFT = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const PUBLISH = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const IMPORT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3";
const ATTEMPT = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const REQUEST = "ffffffff-ffff-4fff-8fff-fffffffffffe";
const SHA = "ab".repeat(32);
const SETTINGS = JSON.stringify({
  geometryResolution: "standard",
  shouldTexture: true,
  textureModel: "default",
  textureResolution: "2k",
  enablePbr: false,
  texturePrompt: "",
  imageEnhancement: true,
  shouldRemesh: false,
  topology: "triangle",
  targetPolycount: 30000,
});

test("deletion cleanup can null foreign keys without reopening account writes", { timeout: 240_000 }, async () => {
  const barrierSql = readFileSync(path.join(process.cwd(), BARRIER), "utf8");
  const fixSql = readFileSync(path.join(process.cwd(), FIX), "utf8");
  assert.match(barrierSql, /not exists \(\s*select 1\s*from pg_trigger/);
  assert.match(fixSql, /pg_trigger_depth\(\) < 2/);
  assert.match(fixSql, /confdeltype = 'n'/);
  assert.match(fixSql, /a_vibode_account_deletion_block_write/);
  assert.doesNotMatch(fixSql, /session_replication_role|set_config\(/);
  assert.doesNotMatch(`${barrierSql}\n${fixSql}`, /api\.meshy\.ai|MESHY_API_KEY/);
  assert.doesNotMatch(fixSql, /set\s+live_enabled|set\s+credit_ceiling|set\s+max_concurrent|set\s+paid_submissions_authorized|set\s+paid_submissions_used/i);

  const dockerProbe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" });
  if (dockerProbe.status !== 0) throw new Error(dockerProbe.stderr);
  await removeContainer();
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error("real_network_blocked");
  };
  try {
    await startPostgres();
    await psql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema if not exists auth;
      create table auth.users (id uuid primary key);
      insert into auth.users (id) values ('${ADMIN}'), ('${U_MAIN}'), ('${U_OTHER}'), ('${U_HOLD}');
      grant usage on schema auth to anon, authenticated, service_role;
      grant select on table auth.users to service_role;
      grant usage on schema public to anon, authenticated, service_role;
      create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create or replace function public.set_timestamp()
      returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
      create schema if not exists storage;
      create table storage.buckets (
        id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
      );
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to service_role;
      grant insert on table storage.objects to service_role;
    `);
    for (const file of BASELINE) await apply(file);
    for (const file of HOSTED_SHAPE) await apply(file);
    await psql(`
      create table public.vibode_stage_partners (
        partner_id text primary key,
        name text not null
      );
      create table public.vibode_stage_partner_drafts (
        draft_id uuid primary key,
        partner_id text not null references public.vibode_stage_partners (partner_id) on delete restrict,
        created_by_user_id uuid references auth.users (id) on delete set null,
        updated_by_user_id uuid references auth.users (id) on delete set null,
        document jsonb not null,
        status text not null,
        revision bigint not null
      );
      create table public.vibode_stage_partner_publishes (
        publish_id uuid primary key,
        partner_id text not null references public.vibode_stage_partners (partner_id) on delete restrict,
        user_id uuid references auth.users (id) on delete set null,
        draft_id uuid not null references public.vibode_stage_partner_drafts (draft_id) on delete restrict,
        draft_revision bigint not null,
        source text not null,
        mode text not null,
        document jsonb not null,
        status text not null,
        created_at timestamptz not null default now()
      );
      create table public.profiles (
        id uuid primary key references auth.users (id) on delete cascade,
        full_name text
      );
      insert into public.vibode_stage_partners (partner_id, name) values ('partner-fk-demo', 'Demo');
      insert into public.vibode_stage_partner_drafts (
        draft_id, partner_id, created_by_user_id, document, status, revision
      ) values (
        '${DRAFT}', 'partner-fk-demo', '${U_MAIN}', '{"kept":"draft"}'::jsonb, 'open', 1
      );
      insert into public.vibode_stage_partner_publishes (
        publish_id, partner_id, user_id, draft_id, draft_revision, source, mode, document, status
      ) values (
        '${PUBLISH}', 'partner-fk-demo', '${U_MAIN}', '${DRAFT}', 1,
        'portal', 'patch', '{"kept":"publish"}'::jsonb, 'accepted'
      );
    `);
    await apply(GUARD);
    await apply(BARRIER);
    assert.equal(await controlFingerprint(), "false|1|40|0|0|0|0");
    assert.equal(await psql(`
      select count(*)::text from pg_trigger
      where tgname = 'vibode_furniture_generation_block_unsettled_account_delete'
        and tgrelid = 'auth.users'::regclass and not tgisinternal
    `), "1");
    assert.equal(await psql(`
      select count(*)::text from pg_trigger
      where tgrelid = 'public.profiles'::regclass
        and not tgisinternal
        and tgname = 'vibode_account_deletion_block_write'
    `), "1");

    await seedAccount();
    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_consumed = 30
      where control_id = 'global'
    `);
    await psql(`
      insert into public.vibode_furniture_generation_jobs (
        job_id, user_id, provider, ai_model, operation, idempotency_key, request_sha256,
        settings, image_slots, provider_task_name, status, progress,
        quota_state, reserved_credits, consumed_credits, allowance_state
      ) values (
        '${JOB_HOLD}', '${U_HOLD}', 'meshy', 'meshy-7.1', 'image-to-3d',
        'hold-key-01', '${SHA}', '${SETTINGS}'::jsonb, array['front']::text[],
        'vibode-${JOB_HOLD}', 'reserved', 0, 'reserved', 30, null, null
      )
    `);
    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_reserved = 30
      where control_id = 'global'
    `);
    const held = await json(`select public.begin_vibode_account_deletion('${U_HOLD}', '${ADMIN}')`);
    assert.equal(held.ok, false);
    assert.equal(held.code, "unsettled_hold");
    assert.equal(await psql(`select credits_reserved::text from public.vibode_furniture_generation_controls`), "30");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'cancelled', quota_state = 'released', consumed_credits = 0
      where job_id = '${JOB_HOLD}';
      update public.vibode_furniture_generation_controls
      set credits_reserved = 0
      where control_id = 'global'
    `);

    const begun = await json(`select public.begin_vibode_account_deletion('${U_MAIN}', '${ADMIN}')`);
    assert.equal(begun.ok, true);
    assert.equal(begun.code, "begun");
    assert.equal(begun.phase, "admitted");
    const claimed = await json(`
      select public.claim_vibode_account_deletion('${U_MAIN}', '${begun.attempt_id}', '${REQUEST}')
    `);
    assert.equal(claimed.ok, true);
    const marked = await json(`
      select public.mark_vibode_account_deletion_destructive('${U_MAIN}', '${begun.attempt_id}', '${REQUEST}')
    `);
    assert.equal(marked.ok, true);
    assert.equal(await psql(`select phase from public.vibode_account_deletion_barriers where user_id = '${U_MAIN}'`), "destructive");

    await psql(`
      create function public.probe_deletion_depth() returns trigger
      language plpgsql as $$ begin raise exception 'DEPTH:%', pg_trigger_depth(); end $$;
      create trigger aaa_probe_deletion_depth
      before update on public.token_ledger
      for each row execute function public.probe_deletion_depth();
    `);
    const directDepth = await expectError(
      `update public.token_ledger set metadata = metadata where id = '${LEDGER}'`,
      /DEPTH:1/,
    );
    assert.match(directDepth, /DEPTH:1/);
    const referentialDepth = await expectError(
      `delete from public.vibode_rooms where id = '${ROOM}'`,
      /DEPTH:2/,
    );
    assert.match(referentialDepth, /DEPTH:2/);
    await psql(`drop trigger aaa_probe_deletion_depth on public.token_ledger`);
    assert.equal(await psql(`select count(*)::text from public.vibode_rooms where id = '${ROOM}'`), "1");

    await expectError(
      `delete from public.vibode_generation_runs where id = '${RUN}'`,
      /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/,
    );
    assert.equal(await psql(`select generation_run_id::text from public.token_ledger where id = '${LEDGER}'`), RUN);
    assert.equal(await psql(`select count(*)::text from public.vibode_generation_runs where id = '${RUN}'`), "1");

    await apply(FIX);
    await psql(`
      create role deletion_fn_owner nologin nosuperuser;
      grant usage on schema public to deletion_fn_owner;
      grant execute on function public.vibode_account_deletion_user_blocked(uuid) to deletion_fn_owner;
      grant execute on function public.vibode_account_deletion_client_command_is_delete() to deletion_fn_owner;
      grant execute on function public.vibode_account_deletion_update_is_referential_cleanup(oid, jsonb, jsonb) to deletion_fn_owner;
      alter table public.vibode_account_deletion_barriers owner to deletion_fn_owner;
      alter function public.vibode_account_deletion_user_blocked(uuid) owner to deletion_fn_owner;
      alter function public.vibode_account_deletion_client_command_is_delete() owner to deletion_fn_owner;
      alter function public.vibode_account_deletion_update_is_referential_cleanup(oid, jsonb, jsonb) owner to deletion_fn_owner;
      alter function public.vibode_account_deletion_block_owned_write() owner to deletion_fn_owner;
    `);

    await expectError(
      `set role service_role; update public.token_ledger set room_id = null where id = '${LEDGER}'`,
      /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/,
    );
    await psql(`
      create function public.try_null_ledger_room(p_id uuid) returns void
      language plpgsql security definer set search_path = pg_catalog, public, pg_temp
      as $$ begin update public.token_ledger set room_id = null where id = p_id; end $$;
      revoke all on function public.try_null_ledger_room(uuid) from public;
      grant execute on function public.try_null_ledger_room(uuid) to service_role;
    `);
    await expectError(
      `set role service_role; select public.try_null_ledger_room('${LEDGER}')`,
      /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/,
    );
    await psql(`
      create table public.probe_parent (id integer primary key, note text);
      insert into public.probe_parent values (1, 'kept');
      create function public.probe_hijack_ledger() returns trigger language plpgsql as $$
      begin
        update public.token_ledger
        set room_id = null, metadata = '{"hijack":true}'::jsonb
        where id = '${LEDGER}';
        return new;
      end $$;
      create trigger probe_hijack before update on public.probe_parent
      for each row execute function public.probe_hijack_ledger();
    `);
    await expectError(`update public.probe_parent set note = 'changed' where id = 1`, /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/);
    assert.equal(await psql(`select note from public.probe_parent where id = 1`), "kept");
    assert.equal(await psql(`select (metadata = '{"kept":"ledger"}'::jsonb)::text from public.token_ledger where id = '${LEDGER}'`), "true");
    assert.equal(await psql(`select room_id::text from public.token_ledger where id = '${LEDGER}'`), ROOM);

    await expectError(
      `set role service_role; update public.vibode_rooms set title = 'Changed' where id = '${ROOM}'`,
      /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/,
    );
    await expectError(`
      insert into public.vibode_furniture_assets (
        asset_id, user_id, display_name, origin,
        authored_width_m, authored_height_m, authored_depth_m,
        sha256, byte_size, storage_bucket, storage_object_path
      ) values (
        'vibode-furniture/personal/cccccccc-cccc-4ccc-8ccc-ccccccccccc8',
        '${U_MAIN}', 'Second', 'uploaded', 1, 1, 1, '${SHA}', 128,
        'vibode-furniture-assets', 'users/${U_MAIN}/assets/cccccccc-cccc-4ccc-8ccc-ccccccccccc8/model.glb'
      )
    `, /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/);
    await expectError(`
      insert into public.vibode_furniture_generation_jobs (
        job_id, user_id, provider, ai_model, operation, idempotency_key, request_sha256,
        settings, image_slots, provider_task_name, status, progress,
        quota_state, reserved_credits, allowance_state
      ) values (
        '${JOB_DIRECT}', '${U_MAIN}', 'meshy', 'meshy-7.1', 'image-to-3d',
        'direct-key-01', '${SHA}', '${SETTINGS}'::jsonb, array['front']::text[],
        'vibode-${JOB_DIRECT}', 'reserved', 0, 'reserved', 30, 'reserved'
      )
    `, /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/);
    const deniedReserve = await serviceJson(`
      public.reserve_vibode_furniture_generation(
        '${U_MAIN}', '${JOB_DIRECT}', 'reserve-key-01', '${SHA}',
        'image-to-3d', 'meshy-7.1', '${SETTINGS}'::jsonb, array['front']::text[], 30
      )
    `);
    assert.equal(deniedReserve.ok, false);
    assert.equal(deniedReserve.code, "account_deletion_in_progress");
    const deniedAttach = await serviceJson(`
      public.attach_vibode_furniture_generation_input(
        '${U_MAIN}', '${JOB_DONE}', 'front', 'image/jpeg', 128, 64, 64, '${SHA}'
      )
    `);
    assert.equal(deniedAttach.ok, false);
    assert.equal(deniedAttach.code, "account_deletion_in_progress");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_inputs`), "0");
    await expectError(
      `set role service_role; insert into storage.objects (bucket_id, name) values ('vibode-furniture-assets', 'users/${U_MAIN}/new.glb')`,
      /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/,
    );
    await psql(`
      set role service_role;
      update public.vibode_rooms set title = 'Other room' where id = '${ROOM_OTHER}';
      insert into storage.objects (bucket_id, name) values ('vibode-furniture-assets', 'users/${U_OTHER}/ok.glb');
    `);
    assert.equal(await psql(`select title from public.vibode_rooms where id = '${ROOM_OTHER}'`), "Other room");

    await psql(`set role service_role; delete from public.vibode_generation_runs where id = '${RUN}'`);
    assert.equal(await psql(`select (generation_run_id is null)::text from public.token_ledger where id = '${LEDGER}'`), "true");
    assert.equal(await psql(`select tokens_delta::text || ':' || (metadata = '{"kept":"ledger"}'::jsonb)::text from public.token_ledger where id = '${LEDGER}'`), "4:true");

    await psql(`set role service_role; delete from public.vibode_room_assets where id = '${ROOM_ASSET}'`);
    assert.equal(await psql(`
      select (source_version_id is null)::text || ':' || (snapshot = '{"kept":"scene"}'::jsonb)::text
      from public.vibode_harmonize_generations where id = '${HARMONIZE}'
    `), "true:true");
    assert.equal(await psql(`
      select (base_asset_id is null)::text || ':' || (active_asset_id is null)::text || ':' || title
      from public.vibode_rooms where id = '${ROOM}'
    `), "true:true:Studio");

    await psql(`set role service_role; delete from public.vibode_rooms where id = '${ROOM}'`);
    assert.equal(await psql(`
      select (room_id is null)::text || ':' || tokens_delta::text || ':' || (metadata = '{"kept":"ledger"}'::jsonb)::text
      from public.token_ledger where id = '${LEDGER}'
    `), "true:4:true");
    assert.equal(await psql(`select count(*)::text from public.vibode_harmonize_generations where id = '${HARMONIZE}'`), "0");

    await expectError(
      `set role service_role; update public.vibode_stage_partner_publishes set document = '{"changed":true}'::jsonb where publish_id = '${PUBLISH}'`,
      /permission denied|42501/,
    );
    assert.equal(await psql(`
      grant select, update on public.vibode_furniture_collection_imports to service_role;
      select has_table_privilege('service_role', 'public.vibode_furniture_collection_imports', 'select')::text
        || has_table_privilege('service_role', 'public.vibode_furniture_collection_imports', 'update')::text
    `), "truetrue");
    await expectError(
      `set role service_role; update public.vibode_furniture_collection_imports set user_id = null where id = '${IMPORT_ID}'`,
      /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/,
    );
    await expectError(
      `set role service_role; update public.profiles set full_name = 'Changed' where id = '${U_MAIN}'`,
      /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/,
    );

    const stale = await json(`select public.abandon_vibode_account_deletion('${U_MAIN}', '${ATTEMPT}', '${ADMIN}')`);
    assert.equal(stale.ok, false);
    assert.equal(stale.code, "attempt_mismatch");
    const tooLate = await json(`select public.abandon_vibode_account_deletion('${U_MAIN}', '${begun.attempt_id}', '${ADMIN}')`);
    assert.equal(tooLate.ok, false);
    assert.equal(tooLate.code, "cleanup_started");
    const hijack = await json(`
      select public.release_vibode_account_deletion_claim('${U_MAIN}', '${begun.attempt_id}', '${ATTEMPT}')
    `);
    assert.equal(hijack.ok, false);
    assert.equal(hijack.code, "attempt_mismatch");

    await psql(`delete from auth.users where id = '${U_MAIN}'`);
    assert.equal(await psql(`
      select (user_id is null)::text || ':' || (document = '{"kept":"publish"}'::jsonb)::text || ':' || status || ':' || source
      from public.vibode_stage_partner_publishes where publish_id = '${PUBLISH}'
    `), "true:true:accepted:portal");
    assert.equal(await psql(`
      select (user_id is null)::text || ':' || source || ':' || (metadata = '{"kept":"import"}'::jsonb)::text || ':' || session_id
      from public.vibode_furniture_collection_imports where id = '${IMPORT_ID}'
    `), "true:public_collection_url:true:session-kept");
    assert.equal(await psql(`
      select (created_by_user_id is null)::text || ':' || (document = '{"kept":"draft"}'::jsonb)::text || ':' || status
      from public.vibode_stage_partner_drafts where draft_id = '${DRAFT}'
    `), "true:true:open");
    assert.equal(await psql(`select count(*)::text from public.vibode_stage_partner_publishes`), "1");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_collection_imports`), "1");
    assert.equal(await psql(`select count(*)::text from auth.users where id = '${U_MAIN}'`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_account_deletion_barriers where user_id = '${U_MAIN}'`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_assets where user_id = '${U_MAIN}'`), "0");
    assert.equal(await psql(`
      select count(*)::text from public.vibode_furniture_generation_allowance_events
      where user_id = '${U_MAIN}' and action = 'consume'
    `), "1");
    assert.equal(await controlFingerprint(), "false|1|40|0|30|0|0");
    const noted = await json(`
      select public.note_vibode_account_deletion_succeeded('${U_MAIN}', '${begun.attempt_id}', '${ADMIN}')
    `);
    assert.equal(noted.ok, true);
    await expectError(
      `delete from public.vibode_account_deletion_events where user_id = '${U_MAIN}'`,
      /VIBODE_ACCOUNT_DELETION:EVENT_IMMUTABLE/,
    );

    const unguarded = await callResult(`
      create trigger a_vibode_account_deletion_block_write
      before insert or update on public.profiles
      for each row execute function public.vibode_account_deletion_block_owned_write('id')
    `);
    assert.notEqual(unguarded.code, 0);
    assert.match(`${unguarded.stderr}\n${unguarded.stdout}`, /already exists/);
    await psql(`drop table public.profiles`);
    await apply(FIX);

    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await removeContainer();
  }
});

async function seedAccount(): Promise<void> {
  await psql(`
    insert into public.vibode_rooms (id, user_id, title) values
      ('${ROOM}', '${U_MAIN}', 'Studio'),
      ('${ROOM_OTHER}', '${U_OTHER}', 'Other');
    insert into public.vibode_room_assets (
      id, room_id, user_id, asset_type, image_url
    ) values (
      '${ROOM_ASSET}', '${ROOM}', '${U_MAIN}', 'original', 'https://example.test/studio.png'
    );
    update public.vibode_rooms
    set base_asset_id = '${ROOM_ASSET}', active_asset_id = '${ROOM_ASSET}'
    where id = '${ROOM}';
    insert into public.vibode_generation_runs (id, room_id, user_id, run_type)
    values ('${RUN}', '${ROOM}', '${U_MAIN}', 'stage');
    insert into public.token_ledger (
      id, user_id, room_id, generation_run_id, event_type, action_type, tokens_delta, metadata
    ) values (
      '${LEDGER}', '${U_MAIN}', '${ROOM}', '${RUN}', 'stage', 'STAGE_1', 4, '{"kept":"ledger"}'::jsonb
    );
    insert into public.vibode_harmonize_generations (
      id, user_id, room_id, source_version_id, idempotency_key, status,
      request_sha256, scene_snapshot_sha256, background_sha256, composite_sha256, prompt_sha256,
      prompt_version, assembly_version, afc_generation_id, snapshot, composite_path,
      composite_byte_length, composite_width, composite_height
    ) values (
      '${HARMONIZE}', '${U_MAIN}', '${ROOM}', '${ROOM_ASSET}',
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc9', 'queued',
      '${SHA}', '${SHA}', '${SHA}', '${SHA}', '${SHA}',
      'v1', 'v1', 'cccccccc-cccc-4ccc-8ccc-cccccccccc10', '{"kept":"scene"}'::jsonb,
      'rooms/${ROOM}/composite.png', 128, 64, 64
    );
    insert into public.vibode_furniture_assets (
      asset_id, user_id, display_name, origin,
      authored_width_m, authored_height_m, authored_depth_m,
      sha256, byte_size, storage_bucket, storage_object_path
    ) values (
      'vibode-furniture/personal/${FURNITURE}', '${U_MAIN}', 'Chair', 'uploaded',
      1, 1, 1, '${SHA}', 128, 'vibode-furniture-assets',
      'users/${U_MAIN}/assets/${FURNITURE}/model.glb'
    );
    insert into public.profiles (id, full_name) values ('${U_MAIN}', 'Kept Name');
    insert into public.vibode_furniture_partners (id, name, slug) values
      ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'Partner', 'fk-partner');
    insert into public.vibode_furniture_collections (id, partner_id, name, slug) values
      ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'Collection', 'fk-collection');
    insert into public.vibode_furniture_collection_imports (
      id, user_id, session_id, collection_id, source, metadata
    ) values (
      '${IMPORT_ID}', '${U_MAIN}', 'session-kept', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
      'public_collection_url', '{"kept":"import"}'::jsonb
    );
    insert into public.vibode_furniture_generation_jobs (
      job_id, user_id, provider, ai_model, operation, idempotency_key, request_sha256,
      settings, image_slots, provider_task_name, status, progress,
      quota_state, reserved_credits, consumed_credits, allowance_state
    ) values (
      '${JOB_DONE}', '${U_MAIN}', 'meshy', 'meshy-7.1', 'image-to-3d',
      'done-key-01', '${SHA}', '${SETTINGS}'::jsonb, array['front']::text[],
      'vibode-${JOB_DONE}', 'failed', 0, 'reconciled', 30, 30, 'consumed'
    );
    insert into public.vibode_furniture_generation_allowance_events (
      user_id, actor_kind, action, delta_authorized, delta_reserved, delta_consumed, job_id, reason
    ) values (
      '${U_MAIN}', 'system', 'consume', 0, -1, 1, '${JOB_DONE}', 'settled'
    );
    grant select, insert, update, delete on
      public.vibode_rooms, public.vibode_room_assets, public.vibode_generation_runs,
      public.token_ledger, public.vibode_harmonize_generations, public.vibode_furniture_assets,
      public.profiles
    to service_role;
  `);
}

async function apply(file: string): Promise<void> {
  await psql(readFileSync(path.join(process.cwd(), file), "utf8"));
}

async function json(sql: string): Promise<Record<string, unknown>> {
  return JSON.parse(await psql(sql)) as Record<string, unknown>;
}

async function serviceJson(statement: string): Promise<Record<string, unknown>> {
  return json(`
    set role service_role;
    select ${statement}
  `);
}

async function controlFingerprint(): Promise<string> {
  return psql(`
    select live_enabled::text || '|' || max_concurrent::text || '|' || credit_ceiling::text
      || '|' || credits_reserved::text || '|' || credits_consumed::text
      || '|' || paid_submissions_authorized::text || '|' || paid_submissions_used::text
    from public.vibode_furniture_generation_controls where control_id = 'global'
  `);
}

async function expectError(sql: string, pattern: RegExp): Promise<string> {
  const result = await callResult(sql);
  assert.notEqual(result.code, 0, result.stdout);
  const text = `${result.stderr}\n${result.stdout}`;
  assert.match(text, pattern);
  return text;
}

async function psql(sql: string): Promise<string> {
  const result = await callResult(sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}\n${sql.slice(0, 800)}`);
  return result.stdout.trim();
}

function callResult(sql: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
}

async function startPostgres(): Promise<void> {
  const started = await docker([
    "run", "-d", "--name", CONTAINER, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", `POSTGRES_DB=${DATABASE}`, "postgres:16-alpine",
  ]);
  if (started.code !== 0) throw new Error(started.stderr || started.stdout);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logs = await docker(["logs", CONTAINER]);
    if (`${logs.stdout}\n${logs.stderr}`.includes("PostgreSQL init process complete")) {
      const probe = await docker(["exec", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-t", "-A", "-c", "select 1"]);
      if (probe.code === 0 && probe.stdout.trim() === "1") return;
    }
    await delay(500);
  }
  throw new Error("disposable postgres 16 did not become ready");
}

async function removeContainer(): Promise<void> {
  await docker(["rm", "-f", CONTAINER]);
}

function docker(args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
