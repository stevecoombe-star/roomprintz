/**
 * MESHY-1D.4F deletion admission barrier on disposable Postgres 16.
 * The chain includes the D2/D3 guard. Provider calls are not made, and fetch throws.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "vibode-account-deletion-1d4f-pg";
const DATABASE = "furniture1d4f";
const MIGRATION = "supabase/migrations/20261112180000_vibode_account_deletion_admission.sql";
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
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U_HOLD = "11111111-1111-4111-8111-111111111111";
const U_RACE = "22222222-2222-4222-8222-222222222222";
const U_DIRECT = "33333333-3333-4333-8333-333333333333";
const U_OTHER = "44444444-4444-4444-8444-444444444444";
const U_CLEAR = "55555555-5555-4555-8555-555555555555";
const U_DONE = "66666666-6666-4666-8666-666666666666";
const J_HOLD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const J_RACE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const J_DIRECT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const J_SETTLED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4";
const J_DONE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5";
const ROOM = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const ASSET = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const REQ_A = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const REQ_B = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const REQ_C = "dddddddd-dddd-4ddd-8ddd-ddddddddddd3";
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

test("account deletion barrier closes the reservation race and blocks new account writes", { timeout: 240_000 }, async () => {
  const migration = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");
  assert.match(migration, /share row exclusive mode/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('vibode-furniture-generation'\)::bigint\)/);
  assert.match(migration, /account_deletion_in_progress/);
  assert.doesNotMatch(migration, /api\.meshy\.ai|MESHY_API_KEY/);
  assert.doesNotMatch(migration, /set\s+live_enabled|set\s+credit_ceiling|set\s+max_concurrent|set\s+paid_submissions_authorized|set\s+paid_submissions_used/i);

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
      insert into auth.users (id) values
        ('${ADMIN}'), ('${U_HOLD}'), ('${U_RACE}'), ('${U_DIRECT}'),
        ('${U_OTHER}'), ('${U_CLEAR}'), ('${U_DONE}');
      grant usage on schema auth to anon, authenticated, service_role;
      grant select on table auth.users to anon, authenticated, service_role;
      grant usage on schema public to anon, authenticated, service_role;
      create or replace function public.set_timestamp()
      returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
      create schema if not exists storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated, service_role;
    `);
    for (const file of BASELINE) await psql(readFileSync(path.join(process.cwd(), file), "utf8"));
    await psql(readFileSync(path.join(process.cwd(), GUARD), "utf8"));
    await psql(`
      create table public.vibode_rooms (
        id uuid primary key,
        user_id uuid not null references auth.users(id) on delete cascade,
        title text not null
      );
    `);
    await psql(readFileSync(path.join(process.cwd(), MIGRATION), "utf8"));
    const fingerprint = await controlFingerprint();
    assert.equal(fingerprint, "false|1|40|0|0|0|0");
    assert.equal(await psql(`
      select count(*)::text from information_schema.columns
      where table_schema = 'public'
        and table_name = 'vibode_account_deletion_barriers'
        and column_name = 'expires_at'
    `), "0");
    assert.equal(await psql(`
      select (position('vibode_furniture_generation_controls' in prosrc) = 0)::text
        || ':' || (position('share row exclusive mode' in prosrc) > 0)::text
        || ':' || (position('pg_advisory_xact_lock' in prosrc) > 0)::text
      from pg_proc where proname = 'begin_vibode_account_deletion'
    `), "true:true:true");
    assert.equal(await psql(`
      select (position('account_deletion_in_progress' in prosrc) > 0)::text
        || ':' || (position('submission_not_authorized' in prosrc) > 0)::text
      from pg_proc where proname = 'reserve_vibode_furniture_generation'
    `), "true:true");
    assert.equal(await psql(`
      select count(*)::text from pg_trigger
      where tgname = 'vibode_account_deletion_block_write'
        and tgrelid in (
          'public.vibode_furniture_assets'::regclass,
          'public.vibode_rooms'::regclass,
          'public.vibode_furniture_generation_inputs'::regclass
        )
        and not tgisinternal
    `), "3");
    assert.equal(await psql(`
      select (position('DELETE' in pg_get_triggerdef(oid)) = 0)::text
      from pg_trigger
      where tgname = 'vibode_account_deletion_block_storage_write' and not tgisinternal
    `), "true");
    await expectDenied(`
      do $$
      begin
        execute 'set local role anon';
        perform public.begin_vibode_account_deletion('${U_CLEAR}', '${ADMIN}');
        raise exception 'anon_was_allowed';
      exception
        when insufficient_privilege then
          null;
      end $$;
    `);
    await expectDenied(`
      do $$
      begin
        execute 'set local role service_role';
        perform 1 from public.vibode_account_deletion_barriers;
        raise exception 'service_role_read_was_allowed';
      exception
        when insufficient_privilege then
          null;
      end $$;
    `);

    await insertJob(U_HOLD, J_HOLD, "hold-key-01", "reserved", "reserved");
    await psql(`update public.vibode_furniture_generation_controls set credits_reserved = 30 where control_id = 'global'`);
    const blocked = await json(`select public.begin_vibode_account_deletion('${U_HOLD}', '${ADMIN}')`);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "unsettled_hold");
    assert.equal(await psql(`select count(*)::text from public.vibode_account_deletion_barriers`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_jobs where job_id = '${J_HOLD}'`), "1");
    assert.equal(await controlFingerprint(), "false|1|40|30|0|0|0");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'cancelled', quota_state = 'released', allowance_state = null
      where job_id = '${J_HOLD}';
      update public.vibode_furniture_generation_controls
      set credits_reserved = 0
      where control_id = 'global';
    `);

    await psql(`
      update public.vibode_furniture_generation_controls
      set live_enabled = true, paid_submissions_authorized = 1, paid_submissions_used = 0
      where control_id = 'global';
    `);
    await insertAllowance(U_RACE);
    const holder = callResult(`
      begin;
      set local role service_role;
      select ${reserveCall(U_RACE, J_RACE, "race-key-0001")}
      where 'deletion-hold-marker' <> '';
      select pg_sleep(6), 'deletion-hold-marker';
      commit;
    `);
    try {
      await waitForSql("open reservation", `
        select count(*)::text from pg_stat_activity
        where query like '%deletion-hold-marker%'
          and wait_event = 'PgSleep'
          and pid <> pg_backend_pid()
      `, "1");
    } catch (error) {
      const result = await holder;
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nholder ${result.code}\n${result.stderr}\n${result.stdout}`);
    }
    const racingBegin = callResult(`
      select public.begin_vibode_account_deletion('${U_RACE}', '${ADMIN}')
      where 'begin-wait-marker' <> ''
    `);
    await waitForSql("deletion waits for the reservation", `
      select count(*)::text from pg_stat_activity
      where query like '%begin-wait-marker%'
        and wait_event_type = 'Lock'
        and pid <> pg_backend_pid()
    `, "1");
    const held = await holder;
    const beganDuringHold = await racingBegin;
    assert.equal(held.code, 0, `${held.stderr}\n${held.stdout}`);
    assert.equal(beganDuringHold.code, 0, `${beganDuringHold.stderr}\n${beganDuringHold.stdout}`);
    const began = JSON.parse(beganDuringHold.stdout.trim()) as { ok?: boolean; code?: string };
    assert.equal(began.ok, false);
    assert.equal(began.code, "unsettled_hold");
    assert.equal(await psql(`select count(*)::text from public.vibode_account_deletion_barriers where user_id = '${U_RACE}'`), "0");
    assert.equal(await psql(`select status || ':' || quota_state from public.vibode_furniture_generation_jobs where job_id = '${J_RACE}'`), "reserved:reserved");
    assert.equal(await psql(`select credits_reserved::text || ':' || paid_submissions_used::text from public.vibode_furniture_generation_controls`), "30:0");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'cancelled', quota_state = 'released', allowance_state = 'released'
      where job_id = '${J_RACE}';
      update public.vibode_furniture_generation_allowances
      set reserved_generations = 0
      where user_id = '${U_RACE}';
      update public.vibode_furniture_generation_controls
      set credits_reserved = 0
      where control_id = 'global';
    `);

    await insertAsset(U_DIRECT);
    await psql(`
      insert into public.vibode_rooms (id, user_id, title) values ('${ROOM}', '${U_DIRECT}', 'Studio');
      insert into storage.objects (bucket_id, name)
      values ('vibode-furniture-assets', 'users/${U_DIRECT}/old.glb');
    `);
    await insertJob(U_DIRECT, J_SETTLED, "settled-key-01", "failed", "released");
    const lockHolder = callResult(`
      begin;
      select pg_advisory_xact_lock(hashtext('vibode-furniture-generation')::bigint);
      lock table public.vibode_furniture_generation_jobs in share row exclusive mode;
      select pg_sleep(6), 'jobs-lock-marker';
      select public.begin_vibode_account_deletion('${U_DIRECT}', '${ADMIN}');
      commit;
    `);
    await waitForSql("jobs lock held", `
      select count(*)::text from pg_stat_activity
      where query like '%jobs-lock-marker%'
        and wait_event = 'PgSleep'
        and pid <> pg_backend_pid()
    `, "1");
    const racingInsert = callResult(directInsert(U_DIRECT, J_DIRECT, "direct-insert-marker"));
    await waitForSql("direct insert waits for the deletion lock", `
      select count(*)::text from pg_stat_activity
      where query like '%direct-insert-marker%'
        and wait_event_type = 'Lock'
        and pid <> pg_backend_pid()
    `, "1");
    const locked = await lockHolder;
    const inserted = await racingInsert;
    assert.equal(locked.code, 0, `${locked.stderr}\n${locked.stdout}`);
    assert.notEqual(inserted.code, 0);
    assert.match(`${inserted.stderr}\n${inserted.stdout}`, /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/);
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_jobs where job_id = '${J_DIRECT}'`), "0");
    assert.equal(await psql(`select phase from public.vibode_account_deletion_barriers where user_id = '${U_DIRECT}'`), "admitted");
    const attempt = await psql(`select attempt_id::text from public.vibode_account_deletion_barriers where user_id = '${U_DIRECT}'`);
    const repeated = await json(`select public.begin_vibode_account_deletion('${U_DIRECT}', '${ADMIN}')`);
    assert.equal(repeated.ok, true);
    assert.equal(repeated.code, "in_progress");
    assert.equal(repeated.attempt_id, attempt);
    assert.equal(await psql(`select count(*)::text from public.vibode_account_deletion_barriers where user_id = '${U_DIRECT}'`), "1");

    const deniedReserve = await serviceJson(reserveCall(U_DIRECT, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8", "direct-reserve-key"));
    assert.equal(deniedReserve.ok, false);
    assert.equal(deniedReserve.code, "account_deletion_in_progress");
    assert.equal(await psql(`select credits_reserved::text || ':' || credits_consumed::text || ':' || paid_submissions_used::text from public.vibode_furniture_generation_controls`), "0:0:0");
    const attached = await serviceJson(`
      public.attach_vibode_furniture_generation_input(
        '${U_DIRECT}', '${J_SETTLED}', 'front', 'image/jpeg', 128, 64, 64, '${SHA}'
      )
    `);
    assert.equal(attached.ok, false);
    assert.equal(attached.code, "account_deletion_in_progress");
    await expectProgress(`
      insert into public.vibode_furniture_generation_inputs (
        job_id, user_id, slot, ordinal, storage_bucket, storage_object_path,
        sha256, byte_size, mime_type, width_px, height_px, expires_at
      ) values (
        '${J_SETTLED}', '${U_DIRECT}', 'front', 0, 'vibode-furniture-generation-inputs',
        'users/${U_DIRECT}/inputs/${J_SETTLED}/front.jpg',
        '${SHA}', 128, 'image/jpeg', 64, 64, now() + interval '1 day'
      )
    `);
    await expectProgress(assetInsert(U_DIRECT, "cccccccc-cccc-4ccc-8ccc-ccccccccccc3", "Chair Two"));
    await expectProgress(`
      update public.vibode_furniture_assets
      set library_visibility = 'archived'
      where user_id = '${U_DIRECT}'
    `);
    assert.equal(await psql(`
      select count(*)::text || ':' || library_visibility
      from public.vibode_furniture_assets where user_id = '${U_DIRECT}'
      group by library_visibility
    `), "1:active");
    await expectProgress(`insert into public.vibode_rooms (id, user_id, title) values ('${cryptoRoom("9")}', '${U_DIRECT}', 'New')`);
    await expectProgress(`update public.vibode_rooms set title = 'Changed' where id = '${ROOM}'`);
    assert.equal(await psql(`select title from public.vibode_rooms where id = '${ROOM}'`), "Studio");
    await expectProgress(`
      insert into storage.objects (bucket_id, name)
      values ('vibode-furniture-assets', 'users/${U_DIRECT}/assets/${ASSET}/model.glb')
    `);
    await expectProgress(`
      insert into storage.objects (bucket_id, name)
      values ('vibode-generations', 'rooms/${ROOM}/cover.png')
    `);
    await psql(`
      insert into public.vibode_rooms (id, user_id, title)
      values ('${cryptoRoom("8")}', '${U_OTHER}', 'Other');
      insert into storage.objects (bucket_id, name)
      values ('vibode-furniture-assets', 'users/${U_OTHER}/keep.glb');
    `);
    await psql(`delete from storage.objects where name = 'users/${U_DIRECT}/old.glb'`);
    assert.equal(await psql(`select count(*)::text from storage.objects where name = 'users/${U_DIRECT}/old.glb'`), "0");
    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'expired'
      where job_id = '${J_SETTLED}'
    `);
    await expectProgress(`
      update public.vibode_furniture_generation_jobs
      set quota_state = 'reserved', consumed_credits = null
      where job_id = '${J_SETTLED}'
    `);
    assert.equal(await psql(`select quota_state from public.vibode_furniture_generation_jobs where job_id = '${J_SETTLED}'`), "released");

    const claimA = await json(`select public.claim_vibode_account_deletion('${U_DIRECT}', '${attempt}', '${REQ_A}')`);
    assert.equal(claimA.ok, true);
    const claimHolder = callResult(`
      begin;
      select public.claim_vibode_account_deletion('${U_DIRECT}', '${attempt}', '${REQ_A}');
      select pg_sleep(6), 'claim-held-marker';
      commit;
    `);
    await waitForSql("claim held", `
      select count(*)::text from pg_stat_activity
      where query like '%claim-held-marker%'
        and wait_event = 'PgSleep'
        and pid <> pg_backend_pid()
    `, "1");
    const racingClaim = callResult(`
      select public.claim_vibode_account_deletion('${U_DIRECT}', '${attempt}', '${REQ_B}')
      where 'claim-wait-marker' <> ''
    `);
    await waitForSql("second claim waits", `
      select count(*)::text from pg_stat_activity
      where query like '%claim-wait-marker%'
        and wait_event_type = 'Lock'
        and pid <> pg_backend_pid()
    `, "1");
    const claimHeld = await claimHolder;
    const secondClaim = await racingClaim;
    assert.equal(claimHeld.code, 0, `${claimHeld.stderr}\n${claimHeld.stdout}`);
    assert.equal(secondClaim.code, 0, `${secondClaim.stderr}\n${secondClaim.stdout}`);
    const secondBody = JSON.parse(secondClaim.stdout.trim()) as { ok?: boolean; code?: string };
    assert.equal(secondBody.ok, false);
    assert.equal(secondBody.code, "deletion_in_progress");
    const staleRelease = await json(`select public.release_vibode_account_deletion_claim('${U_DIRECT}', '${attempt}', '${REQ_B}')`);
    assert.equal(staleRelease.ok, false);
    assert.equal(staleRelease.code, "attempt_mismatch");
    assert.equal(await psql(`select claim_request_id::text from public.vibode_account_deletion_barriers where user_id = '${U_DIRECT}'`), REQ_A);
    const abandonBusy = await json(`select public.abandon_vibode_account_deletion('${U_DIRECT}', '${attempt}', '${ADMIN}')`);
    assert.equal(abandonBusy.ok, false);
    assert.equal(abandonBusy.code, "deletion_in_progress");
    const marked = await json(`select public.mark_vibode_account_deletion_destructive('${U_DIRECT}', '${attempt}', '${REQ_A}')`);
    assert.equal(marked.ok, true);
    const released = await json(`select public.release_vibode_account_deletion_claim('${U_DIRECT}', '${attempt}', '${REQ_A}')`);
    assert.equal(released.ok, true);
    const abandonLate = await json(`select public.abandon_vibode_account_deletion('${U_DIRECT}', '${attempt}', '${ADMIN}')`);
    assert.equal(abandonLate.ok, false);
    assert.equal(abandonLate.code, "cleanup_started");
    assert.equal(await psql(`select phase from public.vibode_account_deletion_barriers where user_id = '${U_DIRECT}'`), "destructive");
    const resumed = await json(`select public.resume_vibode_account_deletion('${U_DIRECT}', '${attempt}', '${ADMIN}')`);
    assert.equal(resumed.ok, true);
    const claimC = await json(`select public.claim_vibode_account_deletion('${U_DIRECT}', '${attempt}', '${REQ_C}')`);
    assert.equal(claimC.ok, true);
    const staleAfterResume = await json(`select public.release_vibode_account_deletion_claim('${U_DIRECT}', '${attempt}', '${REQ_A}')`);
    assert.equal(staleAfterResume.ok, false);
    assert.equal(staleAfterResume.code, "attempt_mismatch");
    assert.equal(await psql(`select claim_request_id::text from public.vibode_account_deletion_barriers where user_id = '${U_DIRECT}'`), REQ_C);
    await json(`select public.release_vibode_account_deletion_claim('${U_DIRECT}', '${attempt}', '${REQ_C}')`);

    await insertAllowance(U_CLEAR);
    const first = await json(`select public.begin_vibode_account_deletion('${U_CLEAR}', '${ADMIN}')`);
    assert.equal(first.ok, true);
    assert.equal(first.code, "begun");
    const staleAbandon = await json(`select public.abandon_vibode_account_deletion('${U_CLEAR}', '${attempt}', '${ADMIN}')`);
    assert.equal(staleAbandon.ok, false);
    assert.equal(staleAbandon.code, "attempt_mismatch");
    assert.equal(await psql(`select attempt_id::text from public.vibode_account_deletion_barriers where user_id = '${U_CLEAR}'`), first.attempt_id);
    const abandoned = await json(`select public.abandon_vibode_account_deletion('${U_CLEAR}', '${first.attempt_id}', '${ADMIN}')`);
    assert.equal(abandoned.ok, true);
    assert.equal(await psql(`select count(*)::text from public.vibode_account_deletion_barriers where user_id = '${U_CLEAR}'`), "0");
    const afterAbandon = await serviceJson(reserveCall(U_CLEAR, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6", "clear-key-01"));
    assert.equal(afterAbandon.ok, true);
    await psql(`
      update public.vibode_furniture_generation_jobs
      set status = 'cancelled', quota_state = 'released', allowance_state = 'released'
      where user_id = '${U_CLEAR}';
      update public.vibode_furniture_generation_allowances
      set reserved_generations = 0
      where user_id = '${U_CLEAR}';
      update public.vibode_furniture_generation_controls
      set credits_reserved = 0
      where control_id = 'global';
    `);

    await insertAllowance(U_DONE);
    await insertJob(U_DONE, J_DONE, "done-key-0001", "failed", "reconciled", "30");
    await insertAsset(U_DONE);
    await psql(`
      update public.vibode_furniture_generation_controls
      set credits_consumed = 30
      where control_id = 'global';
      insert into public.vibode_furniture_generation_allowance_events (
        user_id, actor_kind, action, delta_authorized, delta_reserved, delta_consumed, job_id, reason
      ) values (
        '${U_DONE}', 'system', 'consume', 0, 0, 1, '${J_DONE}', 'Provider charge retained'
      );
    `);
    const done = await json(`select public.begin_vibode_account_deletion('${U_DONE}', '${ADMIN}')`);
    assert.equal(done.ok, true);
    const beforeDelete = await controlFingerprint();
    await psql(`delete from auth.users where id = '${U_DONE}'`);
    assert.equal(await psql(`select count(*)::text from auth.users where id = '${U_DONE}'`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_account_deletion_barriers where user_id = '${U_DONE}'`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_assets where user_id = '${U_DONE}'`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_jobs where job_id = '${J_DONE}'`), "0");
    assert.equal(await psql(`select count(*)::text from public.vibode_furniture_generation_allowance_events where user_id = '${U_DONE}' and action = 'consume'`), "1");
    assert.equal(await controlFingerprint(), beforeDelete);
    const noted = await json(`select public.note_vibode_account_deletion_succeeded('${U_DONE}', '${done.attempt_id}', '${ADMIN}')`);
    assert.equal(noted.ok, true);
    const notedAgain = await json(`select public.note_vibode_account_deletion_succeeded('${U_DONE}', '${done.attempt_id}', '${ADMIN}')`);
    assert.equal(notedAgain.ok, true);
    assert.equal(notedAgain.idempotent, true);
    await expectImmutable(`delete from public.vibode_account_deletion_events where user_id = '${U_DONE}'`);
    assert.equal(await psql(`select count(*)::text from public.vibode_account_deletion_events where user_id = '${U_DONE}' and action = 'succeeded'`), "1");
    await psql(`
      update public.vibode_furniture_generation_controls
      set live_enabled = false,
        paid_submissions_authorized = 0,
        paid_submissions_used = 0,
        credits_reserved = 0,
        credits_consumed = 0
      where control_id = 'global'
    `);
    assert.equal(await controlFingerprint(), fingerprint);
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await removeContainer();
  }
});

function cryptoRoom(digit: string): string {
  return `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
}

function reserveCall(userId: string, jobId: string, key: string): string {
  return `public.reserve_vibode_furniture_generation(
    '${userId}'::uuid,
    '${jobId}'::uuid,
    '${key}',
    '${SHA}',
    'image-to-3d',
    'meshy-7.1',
    '${SETTINGS}'::jsonb,
    array['front']::text[],
    30
  )`;
}

function directInsert(userId: string, jobId: string, marker: string): string {
  return `
    insert into public.vibode_furniture_generation_jobs (
      job_id, user_id, provider, ai_model, operation, idempotency_key, request_sha256,
      settings, image_slots, provider_task_name, status, progress,
      quota_state, reserved_credits, allowance_state
    )
    select
      '${jobId}'::uuid, '${userId}'::uuid, 'meshy', 'meshy-7.1', 'image-to-3d',
      'direct-key-01', '${SHA}', '${SETTINGS}'::jsonb, array['front']::text[],
      'vibode-${jobId}', 'reserved', 0, 'reserved', 30, 'reserved'
    where '${marker}' <> ''
  `;
}

function assetInsert(userId: string, assetUuid: string, name: string): string {
  return `
    insert into public.vibode_furniture_assets (
      asset_id, user_id, display_name, origin,
      authored_width_m, authored_height_m, authored_depth_m,
      sha256, byte_size, storage_bucket, storage_object_path
    ) values (
      'vibode-furniture/personal/${assetUuid}',
      '${userId}',
      '${name}',
      'uploaded',
      1, 1, 1,
      '${SHA}',
      128,
      'vibode-furniture-assets',
      'users/${userId}/assets/${assetUuid}/model.glb'
    )
  `;
}

async function insertAsset(userId: string): Promise<void> {
  const suffix = userId.slice(-2);
  await psql(assetInsert(userId, `cccccccc-cccc-4ccc-8ccc-cccccccccc${suffix}`, "Chair"));
}

async function insertJob(
  userId: string,
  jobId: string,
  key: string,
  status: string,
  quotaState: string,
  consumed = "null",
): Promise<void> {
  await psql(`
    insert into public.vibode_furniture_generation_jobs (
      job_id, user_id, provider, ai_model, operation, idempotency_key, request_sha256,
      settings, image_slots, provider_task_name, status, progress,
      quota_state, reserved_credits, consumed_credits, allowance_state
    ) values (
      '${jobId}', '${userId}', 'meshy', 'meshy-7.1', 'image-to-3d',
      '${key}', '${SHA}', '${SETTINGS}'::jsonb, array['front']::text[],
      'vibode-${jobId}', '${status}', 0,
      '${quotaState}', 30, ${consumed}, null
    )
  `);
}

async function insertAllowance(userId: string): Promise<void> {
  await psql(`
    insert into public.vibode_furniture_generation_allowances (
      user_id, classification, enabled, authorized_generations,
      reserved_generations, consumed_generations, updated_by
    ) values (
      '${userId}', 'individual_beta', true, 1, 0, 0, '${ADMIN}'
    )
  `);
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

async function expectProgress(sql: string): Promise<void> {
  const result = await callResult(sql);
  assert.notEqual(result.code, 0, result.stdout);
  assert.match(`${result.stderr}\n${result.stdout}`, /VIBODE_ACCOUNT_DELETION:IN_PROGRESS/);
}

async function expectImmutable(sql: string): Promise<void> {
  const result = await callResult(sql);
  assert.notEqual(result.code, 0, result.stdout);
  assert.match(`${result.stderr}\n${result.stdout}`, /VIBODE_ACCOUNT_DELETION:EVENT_IMMUTABLE/);
}

async function expectDenied(sql: string): Promise<void> {
  const result = await callResult(sql);
  assert.equal(result.code, 0, `${result.stderr}\n${result.stdout}`);
}

async function waitForSql(label: string, sql: string, expected: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await psql(sql) === expected) return;
    await delay(100);
  }
  const visible = await psql(`
    select coalesce(string_agg(state || ':' || coalesce(wait_event_type, '-') || ':' || coalesce(wait_event, '-') || ':' || left(query, 120), ' || '), 'none')
    from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid()
  `);
  throw new Error(`timed out waiting for ${label}: ${visible}`);
}

async function psql(sql: string): Promise<string> {
  const result = await callResult(sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}\n${sql.slice(0, 500)}`);
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
