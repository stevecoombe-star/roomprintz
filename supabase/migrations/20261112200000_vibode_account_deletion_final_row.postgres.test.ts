/**
 * MESHY-1D.4J final stored row during account-deletion cleanup.
 * Disposable Postgres 16. The D4I metadata rewrite is reproduced on
 * 20261112190000, then the new migration must reject it. Provider calls
 * are not made, and fetch throws.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-account-deletion-1d4j-pg";
const DATABASE = "furniture1d4j";
const BARRIER = "supabase/migrations/20261112180000_vibode_account_deletion_admission.sql";
const CLEANUP = "supabase/migrations/20261112190000_vibode_account_deletion_referential_cleanup.sql";
const FINAL = "supabase/migrations/20261112200000_vibode_account_deletion_final_row.sql";
const GUARD = "supabase/migrations/20261112170000_vibode_furniture_generation_account_deletion_guard.sql";
const BARRIER_SHA256 = "b20fab842e525cda877c08159666bcc6384817195e1b59e506ceeac75618eb22";
const CLEANUP_SHA256 = "6561f928c30765db52b34dcc3b043b0bd8bf76edfabab8efcafa727d111050fa";
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
const RUN_BEFORE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const LEDGER_BEFORE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc4";
const HARMONIZE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc5";
const FURNITURE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc6";
const RUN_AFTER = "cccccccc-cccc-4ccc-8ccc-ccccccccccb1";
const LEDGER_AFTER = "cccccccc-cccc-4ccc-8ccc-ccccccccccb2";
const LEDGER_RESIDUAL = "cccccccc-cccc-4ccc-8ccc-ccccccccccb3";
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

test("final stored row rejects business changes during deletion cleanup", { timeout: 240_000 }, async () => {
  const barrierSql = readFileSync(path.join(process.cwd(), BARRIER));
  const cleanupSql = readFileSync(path.join(process.cwd(), CLEANUP));
  const finalSql = readFileSync(path.join(process.cwd(), FINAL), "utf8");
  assert.equal(createHash("sha256").update(barrierSql).digest("hex"), BARRIER_SHA256);
  assert.equal(createHash("sha256").update(cleanupSql).digest("hex"), CLEANUP_SHA256);
  assert.match(finalSql, /vibode_account_deletion_final_row_allowed/);
  assert.match(finalSql, /z_vibode_account_deletion_final_row/);
  assert.match(finalSql, /confdeltype = 'n'/);
  assert.match(finalSql, /transaction_timestamp\(\)/);
  assert.match(finalSql, /vibode_account_deletion_cascade_guard/);
  assert.match(finalSql, /set_timestamp/);
  const executableFinalSql = finalSql.replace(/--.*$/gm, "");
  assert.doesNotMatch(executableFinalSql, /pg_trigger_depth|current_query|session_replication_role|set_config\(/);
  assert.doesNotMatch(finalSql, /api\.meshy\.ai|MESHY_API_KEY/);
  assert.doesNotMatch(finalSql, /set\s+live_enabled|set\s+credit_ceiling|set\s+max_concurrent|set\s+paid_submissions_authorized|set\s+paid_submissions_used/i);

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
    await apply(CLEANUP);
    assert.equal(await controlFingerprint(), "false|1|40|0|0|0|0");
    assert.equal(await psql(`
      select count(*)::text from pg_trigger
      where tgname = 'vibode_furniture_generation_block_unsettled_account_delete'
        and tgrelid = 'auth.users'::regclass and not tgisinternal
    `), "1");

    await seedAccount();
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

    await psql(`
      insert into public.vibode_furniture_generation_jobs (
        job_id, user_id, provider, ai_model, operation, idempotency_key, request_sha256,
        settings, image_slots, provider_task_name, status, progress,
        quota_state, reserved_credits, consumed_credits, allowance_state
      ) values (
        '${JOB_HOLD}', '${U_HOLD}', 'meshy', 'meshy-7.1', 'image-to-3d',
        'hold-key-01', '${SHA}', '${SETTINGS}'::jsonb, array['front']::text[],
        'vibode-${JOB_HOLD}', 'reserved', 0, 'reserved', 30, null, null
      );
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
    assert.equal(begun.phase, "admitted");
    const claimed = await json(`
      select public.claim_vibode_account_deletion('${U_MAIN}', '${begun.attempt_id}', '${REQUEST}')
    `);
    assert.equal(claimed.ok, true);
    const marked = await json(`
      select public.mark_vibode_account_deletion_destructive('${U_MAIN}', '${begun.attempt_id}', '${REQUEST}')
    `);
    assert.equal(marked.ok, true);

    await expectError(
      `update public.token_ledger set metadata = '{"direct":true}'::jsonb where id = '${LEDGER_AFTER}'`,
      /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/,
    );

    await psql(`
      create function public.probe_later_meta() returns trigger
      language plpgsql as $$
      begin
        new.metadata = '{"hijack":true}'::jsonb;
        return new;
      end $$;
      create trigger zzz_probe_later_meta
      before update on public.token_ledger
      for each row execute function public.probe_later_meta();
    `);
    await psql(`delete from public.vibode_generation_runs where id = '${RUN_BEFORE}'`);
    assert.equal(await psql(`
      select (generation_run_id is null)::text || ':' || (metadata = '{"hijack":true}'::jsonb)::text
      from public.token_ledger where id = '${LEDGER_BEFORE}'
    `), "true:true");
    assert.equal(await psql(`select count(*)::text from public.vibode_generation_runs where id = '${RUN_BEFORE}'`), "0");

    await apply(FINAL);
    assert.equal(await controlFingerprint(), "false|1|40|0|0|0|0");
    await psql(`
      grant execute on function public.vibode_account_deletion_final_row_allowed(oid, jsonb, jsonb) to deletion_fn_owner;
      grant execute on function public.vibode_account_deletion_user_blocked(uuid) to deletion_fn_owner;
      alter function public.vibode_account_deletion_final_row_allowed(oid, jsonb, jsonb) owner to deletion_fn_owner;
      alter function public.vibode_account_deletion_enforce_final_row() owner to deletion_fn_owner;
      alter table public.vibode_account_deletion_cascade_guard owner to deletion_fn_owner;
    `);
    assert.equal(await psql(`
      select count(*)::text
      from pg_trigger as t
      join pg_proc as fn on fn.oid = t.tgfoid
      where t.tgrelid = 'public.token_ledger'::regclass
        and t.tgname = 'z_vibode_account_deletion_final_row'
        and fn.proname = 'vibode_account_deletion_enforce_final_row'
        and (t.tgtype::integer & 2) = 0
        and (t.tgtype::integer & 16) <> 0
        and not t.tgisinternal
    `), "1");
    assert.equal(await psql(`
      select position('pg_trigger_depth' in prosrc)::text
      from pg_proc
      where proname = 'vibode_account_deletion_final_row_allowed'
    `), "0");
    assert.equal(await psql(`
      select count(*)::text from pg_trigger
      where tgrelid = 'auth.users'::regclass
        and tgname in (
          'a_vibode_account_deletion_note_cascade',
          'z_vibode_account_deletion_clear_cascade_guard'
        )
        and not tgisinternal
    `), "2");
    assert.equal(await psql(`
      select has_function_privilege('service_role', 'public.vibode_account_deletion_final_row_allowed(oid,jsonb,jsonb)', 'execute')::text
        || has_function_privilege('anon', 'public.vibode_account_deletion_enforce_final_row()', 'execute')::text
    `), "falsetrue");

    await expectError(
      `update public.token_ledger set metadata = '{"direct":true}'::jsonb where id = '${LEDGER_AFTER}'`,
      /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/,
    );
    await expectError(
      `set role service_role; update public.token_ledger set room_id = null where id = '${LEDGER_AFTER}'`,
      /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/,
    );
    await expectError(`
      create function public.try_change_ledger(p_id uuid) returns void
      language plpgsql security definer
      set search_path = pg_catalog, public, pg_temp
      as $$ begin update public.token_ledger set metadata = '{"hijack":true}'::jsonb where id = p_id; end $$;
      revoke all on function public.try_change_ledger(uuid) from public;
      grant execute on function public.try_change_ledger(uuid) to service_role, authenticated, anon;
      set role service_role;
      select public.try_change_ledger('${LEDGER_AFTER}'::uuid)
    `, /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/);
    await expectError(`delete from public.vibode_generation_runs where id = '${RUN_AFTER}'`, /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/);
    assert.equal(await psql(`
      select (generation_run_id = '${RUN_AFTER}')::text || ':' || (metadata = '{"kept":"ledger"}'::jsonb)::text || ':' || tokens_delta::text
      from public.token_ledger where id = '${LEDGER_AFTER}'
    `), "true:true:4");
    assert.equal(await psql(`select count(*)::text from public.vibode_generation_runs where id = '${RUN_AFTER}'`), "1");
    await psql(`drop trigger zzz_probe_later_meta on public.token_ledger`);

    await psql(`
      create function public.probe_later_amount() returns trigger
      language plpgsql as $$
      begin
        new.tokens_delta = 99;
        return new;
      end $$;
      create trigger zzz_probe_later_amount
      before update on public.token_ledger
      for each row execute function public.probe_later_amount();
    `);
    await expectError(`delete from public.vibode_generation_runs where id = '${RUN_AFTER}'`, /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/);
    assert.equal(await psql(`select tokens_delta::text from public.token_ledger where id = '${LEDGER_AFTER}'`), "4");
    await psql(`drop trigger zzz_probe_later_amount on public.token_ledger`);

    await psql(`
      create function public.probe_later_status() returns trigger
      language plpgsql as $$
      begin
        new.status = 'failed';
        return new;
      end $$;
      create trigger zzz_probe_later_status
      before update on public.vibode_harmonize_generations
      for each row execute function public.probe_later_status();
    `);
    await expectError(`delete from public.vibode_room_assets where id = '${ROOM_ASSET}'`, /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/);
    assert.equal(await psql(`
      select status || ':' || (snapshot = '{"kept":"scene"}'::jsonb)::text || ':' || (source_version_id = '${ROOM_ASSET}')::text
      from public.vibode_harmonize_generations where id = '${HARMONIZE}'
    `), "queued:true:true");
    await psql(`drop trigger zzz_probe_later_status on public.vibode_harmonize_generations`);

    await psql(`
      create function public.probe_later_owner() returns trigger
      language plpgsql as $$
      begin
        new.user_id = '${U_OTHER}';
        return new;
      end $$;
      create trigger zzz_probe_later_owner
      before update on public.vibode_furniture_collection_imports
      for each row execute function public.probe_later_owner();
    `);
    await expectError(`delete from auth.users where id = '${U_MAIN}'`, /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/);
    assert.equal(await psql(`select user_id::text from public.vibode_furniture_collection_imports where id = '${IMPORT_ID}'`), U_MAIN);
    assert.equal(await psql(`select count(*)::text from auth.users where id = '${U_MAIN}'`), "1");
    await psql(`drop trigger zzz_probe_later_owner on public.vibode_furniture_collection_imports`);

    await psql(`
      create function public.probe_extra_update() returns trigger
      language plpgsql as $$
      begin
        update public.token_ledger
        set metadata = '{"hijack":true}'::jsonb
        where id = '${LEDGER_AFTER}';
        return null;
      end $$;
      create trigger zzz_probe_extra_update
      after delete on public.vibode_generation_runs
      for each row execute function public.probe_extra_update();
    `);
    await expectError(`delete from public.vibode_generation_runs where id = '${RUN_AFTER}'`, /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/);
    assert.equal(await psql(`
      select (metadata = '{"kept":"ledger"}'::jsonb)::text || ':' || (generation_run_id = '${RUN_AFTER}')::text
      from public.token_ledger where id = '${LEDGER_AFTER}'
    `), "true:true");
    await psql(`drop trigger zzz_probe_extra_update on public.vibode_generation_runs`);

    await psql(`
      create function public.probe_room_clock() returns trigger
      language plpgsql as $$
      begin
        new.updated_at = '2000-01-01T00:00:00Z';
        return new;
      end $$;
      create trigger zzz_probe_room_clock
      before update on public.vibode_rooms
      for each row execute function public.probe_room_clock();
    `);
    await expectError(`delete from public.vibode_room_assets where id = '${ROOM_ASSET}'`, /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/);
    assert.equal(await psql(`select title from public.vibode_rooms where id = '${ROOM}'`), "Studio");
    assert.equal(await psql(`select (updated_at = '2000-01-01T00:00:00Z')::text from public.vibode_rooms where id = '${ROOM}'`), "false");
    await psql(`drop trigger zzz_probe_room_clock on public.vibode_rooms`);

    await psql(`delete from public.vibode_generation_runs where id = '${RUN_AFTER}'`);
    assert.equal(await psql(`
      select (generation_run_id is null)::text || ':' || (metadata = '{"kept":"ledger"}'::jsonb)::text || ':' || tokens_delta::text || ':' || user_id::text
      from public.token_ledger where id = '${LEDGER_AFTER}'
    `), `true:true:4:${U_MAIN}`);

    const harmonizeBefore = await psql(`select updated_at::text from public.vibode_harmonize_generations where id = '${HARMONIZE}'`);
    assert.equal(await psql(`
      begin;
      delete from public.vibode_room_assets where id = '${ROOM_ASSET}';
      select (title = 'Studio')::text
        || ':' || (base_asset_id is null)::text
        || ':' || (active_asset_id is null)::text
        || ':' || (updated_at = transaction_timestamp())::text
      from public.vibode_rooms where id = '${ROOM}';
      commit;
    `), "true:true:true:true");
    assert.equal(await psql(`
      select status || ':' || (snapshot = '{"kept":"scene"}'::jsonb)::text
        || ':' || (source_version_id is null)::text
        || ':' || (updated_at = '${harmonizeBefore}'::timestamptz)::text
      from public.vibode_harmonize_generations where id = '${HARMONIZE}'
    `), "queued:true:true:true");

    await psql(`
      create table public.decoy_parent (id integer primary key);
      insert into public.decoy_parent (id) values (1);
      create function public.probe_null_and_meta() returns trigger
      language plpgsql as $$
      begin
        update public.token_ledger
        set room_id = null, metadata = '{"hijack":true}'::jsonb
        where id = '${LEDGER_RESIDUAL}';
        return old;
      end $$;
      create trigger probe_null_and_meta
      before delete on public.decoy_parent
      for each row execute function public.probe_null_and_meta();
    `);
    await expectError(`delete from public.decoy_parent where id = 1`, /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/);
    assert.equal(await psql(`
      select (room_id = '${ROOM}')::text || ':' || (metadata = '{"kept":"residual"}'::jsonb)::text
      from public.token_ledger where id = '${LEDGER_RESIDUAL}'
    `), "true:true");
    await psql(`
      drop trigger probe_null_and_meta on public.decoy_parent;
      create function public.probe_null_room_only() returns trigger
      language plpgsql as $$
      begin
        update public.token_ledger set room_id = null where id = '${LEDGER_RESIDUAL}';
        return old;
      end $$;
      create trigger probe_null_room_only
      before delete on public.decoy_parent
      for each row execute function public.probe_null_room_only();
    `);
    await psql(`delete from public.decoy_parent where id = 1`);
    assert.equal(
      await psql(`
        select (room_id is null)::text || ':' || (metadata = '{"kept":"residual"}'::jsonb)::text || ':' || tokens_delta::text
        from public.token_ledger where id = '${LEDGER_RESIDUAL}'
      `),
      "true:true:4",
      "residual ownership-boundary: an owner DELETE trigger that only nulls a SET NULL foreign key still commits; this is not proof of an internal foreign-key action",
    );

    await expectError(`
      create or replace function auth.uid() returns uuid
      language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
      grant select, update on public.vibode_rooms to authenticated;
      set app.uid = '${U_MAIN}';
      set role authenticated;
      update public.vibode_rooms set title = 'Hijack' where id = '${ROOM}';
    `, /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/);
    assert.equal(await psql(`select title from public.vibode_rooms where id = '${ROOM}'`), "Studio");
    await psql(`
      set app.uid = '${U_OTHER}';
      set role authenticated;
      update public.vibode_rooms set title = 'Other kept' where id = '${ROOM_OTHER}';
    `);
    assert.equal(await psql(`select title from public.vibode_rooms where id = '${ROOM_OTHER}'`), "Other kept");

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
    await expectError(
      `set role service_role; insert into storage.objects (bucket_id, name) values ('vibode-furniture-assets', 'users/${U_MAIN}/new.glb')`,
      /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/,
    );
    await psql(`
      create function public.probe_storage_name() returns trigger
      language plpgsql as $$
      begin
        new.name = 'users/${U_MAIN}/hijack.glb';
        return new;
      end $$;
      create trigger zzz_probe_storage_name
      before insert on storage.objects
      for each row execute function public.probe_storage_name();
    `);
    await expectError(
      `set role service_role; insert into storage.objects (bucket_id, name) values ('vibode-furniture-assets', 'users/${U_OTHER}/safe.glb')`,
      /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/,
    );
    await psql(`drop trigger zzz_probe_storage_name on storage.objects`);
    await psql(`
      set role service_role;
      insert into storage.objects (bucket_id, name) values ('vibode-furniture-assets', 'users/${U_OTHER}/ok.glb');
      update public.vibode_rooms set title = 'Other again' where id = '${ROOM_OTHER}';
    `);
    assert.equal(await psql(`select title from public.vibode_rooms where id = '${ROOM_OTHER}'`), "Other again");
    assert.equal(await psql(`select count(*)::text from storage.objects where name = 'users/${U_OTHER}/ok.glb'`), "1");
    await expectError(
      `set role service_role; create trigger customer_trigger before update on public.vibode_rooms for each row execute function public.probe_room_clock()`,
      /permission denied/,
    );
    await expectError(
      `set role service_role; insert into public.vibode_account_deletion_cascade_guard (account_id) values ('${U_OTHER}')`,
      /permission denied/,
    );

    await expectError(
      `update public.profiles set full_name = 'Changed' where id = '${U_MAIN}'`,
      /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/,
    );
    await expectError(
      `set role service_role; update public.vibode_stage_partner_publishes set status = 'rejected' where publish_id = '${PUBLISH}'`,
      /permission denied|42501/,
    );

    await psql(`
      create function public.probe_publish_status() returns trigger
      language plpgsql as $$
      begin
        new.status = 'rejected';
        new.document = '{"hijack":true}'::jsonb;
        return new;
      end $$;
      create trigger zzz_probe_publish_status
      before update on public.vibode_stage_partner_publishes
      for each row execute function public.probe_publish_status();
    `);
    await expectError(`delete from auth.users where id = '${U_MAIN}'`, /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/);
    assert.equal(await psql(`
      select status || ':' || (document = '{"kept":"publish"}'::jsonb)::text
      from public.vibode_stage_partner_publishes where publish_id = '${PUBLISH}'
    `), "accepted:true");
    await psql(`drop trigger zzz_probe_publish_status on public.vibode_stage_partner_publishes`);

    const draftLimitation = await psql(`
      begin;
      create function public.probe_draft_document() returns trigger
      language plpgsql as $$
      begin
        new.document = '{"hijack":true}'::jsonb;
        return new;
      end $$;
      create trigger zzz_probe_draft_document
      before update on public.vibode_stage_partner_drafts
      for each row execute function public.probe_draft_document();
      delete from auth.users where id = '${U_MAIN}';
      select document::text from public.vibode_stage_partner_drafts where draft_id = '${DRAFT}';
      rollback;
    `);
    assert.match(draftLimitation, /hijack/);
    assert.equal(await psql(`
      select (document = '{"kept":"draft"}'::jsonb)::text || ':' || count(*)::text
      from public.vibode_stage_partner_drafts where draft_id = '${DRAFT}'
      group by document
    `), "true:1");
    assert.equal(await psql(`select count(*)::text from auth.users where id = '${U_MAIN}'`), "1");

    const stale = await json(`select public.abandon_vibode_account_deletion('${U_MAIN}', '${ATTEMPT}', '${ADMIN}')`);
    assert.equal(stale.ok, false);
    assert.equal(stale.code, "attempt_mismatch");
    const tooLate = await json(`select public.abandon_vibode_account_deletion('${U_MAIN}', '${begun.attempt_id}', '${ADMIN}')`);
    assert.equal(tooLate.ok, false);
    assert.equal(tooLate.code, "cleanup_started");
    const resumed = await json(`select public.resume_vibode_account_deletion('${U_MAIN}', '${begun.attempt_id}', '${ADMIN}')`);
    assert.equal(resumed.ok, true);
    assert.equal(resumed.phase, "destructive");
    assert.equal(await psql(`
      select phase || ':' || (claim_request_id is null)::text
      from public.vibode_account_deletion_barriers where user_id = '${U_MAIN}'
    `), "destructive:true");

    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_consumed = 30
      where control_id = 'global'
    `);
    const duplicate = await callResult(`
      create trigger z_vibode_account_deletion_final_row
      after update on public.token_ledger
      for each row execute function public.vibode_account_deletion_enforce_final_row()
    `);
    assert.notEqual(duplicate.code, 0);
    assert.match(`${duplicate.stderr}\n${duplicate.stdout}`, /already exists/);
    await psql(`drop table public.profiles`);
    await apply(FINAL);

    assert.equal(await psql(`
      begin;
      delete from auth.users where id = '${U_MAIN}';
      select (updated_at = transaction_timestamp())::text
        || ':' || (user_id is null)::text
        || ':' || source
        || ':' || (metadata = '{"kept":"import"}'::jsonb)::text
      from public.vibode_furniture_collection_imports where id = '${IMPORT_ID}';
      commit;
    `), "true:true:public_collection_url:true");
    assert.equal(await psql(`
      select (user_id is null)::text || ':' || status || ':' || source || ':' || (document = '{"kept":"publish"}'::jsonb)::text
      from public.vibode_stage_partner_publishes where publish_id = '${PUBLISH}'
    `), "true:accepted:portal:true");
    assert.equal(await psql(`
      select (created_by_user_id is null)::text || ':' || (document = '{"kept":"draft"}'::jsonb)::text || ':' || status
      from public.vibode_stage_partner_drafts where draft_id = '${DRAFT}'
    `), "true:true:open");
    assert.equal(await psql(`select count(*)::text from public.vibode_stage_partner_publishes`), "1");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_collection_imports`), "1");
    assert.equal(await psql(`select count(*)::text from auth.users where id = '${U_MAIN}'`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_account_deletion_barriers where user_id = '${U_MAIN}'`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_account_deletion_cascade_guard`), "0");
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
    await expectError(
      `delete from public.vibode_furniture_generation_allowance_events where user_id = '${U_MAIN}'`,
      /VIBODE_FURNITURE_GENERATION:ALLOWANCE_EVENT_IMMUTABLE/,
    );
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
    insert into public.vibode_generation_runs (id, room_id, user_id, run_type) values
      ('${RUN_BEFORE}', '${ROOM}', '${U_MAIN}', 'stage'),
      ('${RUN_AFTER}', '${ROOM}', '${U_MAIN}', 'stage');
    insert into public.token_ledger (
      id, user_id, room_id, generation_run_id, event_type, action_type, tokens_delta, metadata
    ) values
      ('${LEDGER_BEFORE}', '${U_MAIN}', '${ROOM}', '${RUN_BEFORE}', 'stage', 'STAGE_1', 4, '{"kept":"ledger"}'::jsonb),
      ('${LEDGER_AFTER}', '${U_MAIN}', '${ROOM}', '${RUN_AFTER}', 'stage', 'STAGE_1', 4, '{"kept":"ledger"}'::jsonb),
      ('${LEDGER_RESIDUAL}', '${U_MAIN}', '${ROOM}', null, 'stage', 'STAGE_1', 4, '{"kept":"residual"}'::jsonb);
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
      public.profiles, public.vibode_furniture_collection_imports
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
