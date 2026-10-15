/**
 * HARMONIZE-3B1F: publication activation against disposable Postgres 16.
 * Applies the repository migrations that define rooms, scenes, AFC, and
 * Harmonize publication. No hosted database, no published port.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTAINER = "harmonize-pg-3b1f-disposable";
const SHA = "ab".repeat(32);
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const MIGRATIONS = [
  "20260316090000_create_public_set_timestamp_function.sql",
  "20260316100000_vibode_persistence_foundation.sql",
  "20260330110000_vibode_asset_thumbnails.sql",
  "20260908213000_vibode_afc_v2_production_generations.sql",
  "20260910160000_vibode_3d_scenes.sql",
  "20261003160000_vibode_room_scale_multiplier.sql",
  "20261003170000_vibode_room_scale_multiplier_range.sql",
  "20261003180000_vibode_room_scale_multiplier_beta_range.sql",
  "20261012090000_vibode_harmonize_generations.sql",
  "20261013010000_vibode_harmonize_exact_claim.sql",
  "20261013140000_vibode_harmonize_history_publication.sql",
  "20261013150000_vibode_harmonize_enqueue_publication.sql",
];

const SCENE = [
  {
    objectId: "obj-1",
    assetId: "model-1",
    transform: { uniformScale: 1, position: { x: 1, y: 0, z: 2 } },
  },
  {
    objectId: "obj-2",
    assetId: "model-2",
    transform: { uniformScale: 0.94, position: { x: 0.25, y: 0, z: 2 } },
  },
];

type Json = Record<string, unknown>;
type Kind = "activated" | "inactive" | "rejected";

type Fixture = Readonly<{
  name: string;
  expect: Kind;
  code?: string;
  roomScale?: number;
  snapshotScale?: unknown;
  omitScale?: boolean;
  scene?: "match" | "moved" | "missing" | "string-number" | "both-strings" | "swapped" | "numeric-text";
  active?: "source" | "other" | "null";
  roomAfc?: "match" | "other" | "null";
  sceneAfc?: "match" | "other";
  sceneUser?: "owner" | "other";
  source?: "present" | "other-room" | "null" | "deleted";
  jobUser?: "owner" | "other";
  asServiceRole?: boolean;
}>;

type Seed = Readonly<{
  jobId: string;
  roomId: string;
  sourceId: string;
  generationId: string;
  sceneText: string;
  roomScale: number;
  afcText: string;
}>;

let seq = 0;

test("postgres 16 activation follows the publication predicates and can diverge from a later read", { timeout: 300_000 }, async () => {
  await removeContainer();
  try {
    await startPostgres();
    await applyMigrations();
    assert.match(await psql("select current_setting('server_version')"), /^16\./);
    await psql(`insert into auth.users (id) values ('${USER}'), ('${OTHER}');`);
    await psql("create table public.forensic_signal (key integer primary key);");

    const probes = await readJson(`
      select json_build_object(
        'number_type', jsonb_typeof('{"roomScaleMultiplier":0.94}'::jsonb->'roomScaleMultiplier'),
        'string_type', jsonb_typeof('{"roomScaleMultiplier":"0.94"}'::jsonb->'roomScaleMultiplier'),
        'text_equal', ('{"roomScaleMultiplier":0.94}'::jsonb->>'roomScaleMultiplier')
          is not distinct from ('{"roomScaleMultiplier":"0.94"}'::jsonb->>'roomScaleMultiplier'),
        'float_equal', 0.94::double precision = ('{"roomScaleMultiplier":0.94}'::jsonb->>'roomScaleMultiplier')::double precision,
        'integer_equals_decimal', '{"uniformScale":1}'::jsonb = '{"uniformScale":1.0}'::jsonb,
        'number_equals_numeric_string', '{"uniformScale":1}'::jsonb = '{"uniformScale":"1"}'::jsonb,
        'reordered_objects_equal', ${quote(JSON.stringify(SCENE))}::jsonb = ${quote(JSON.stringify(reorder(SCENE)))}::jsonb,
        'null_safe_match', null::uuid is not distinct from null::uuid,
        'plain_null_equal', coalesce((null::uuid = null::uuid)::text, 'unknown'),
        'boundaries', jsonb_build_object(
          'low', 0.25::double precision = ('{"roomScaleMultiplier":0.25}'::jsonb->>'roomScaleMultiplier')::double precision,
          'high', 2::double precision = ('{"roomScaleMultiplier":2.00}'::jsonb->>'roomScaleMultiplier')::double precision
        )
      )
    `);
    assert.equal(probes.number_type, "number");
    assert.equal(probes.string_type, "string");
    assert.equal(probes.text_equal, true);
    assert.equal(probes.float_equal, true);
    assert.equal(probes.integer_equals_decimal, true);
    assert.equal(probes.number_equals_numeric_string, false);
    assert.equal(probes.reordered_objects_equal, true);
    assert.equal(probes.null_safe_match, true);
    assert.equal(probes.plain_null_equal, "unknown");
    assert.equal((probes.boundaries as Json).low, true);
    assert.equal((probes.boundaries as Json).high, true);

    const installed = await readJson(`
      select json_build_object(
        'function_owner', pg_get_userbyid(fn.proowner),
        'security_definer', fn.prosecdef,
        'rooms_owner', pg_get_userbyid(rooms.relowner),
        'rooms_rls', rooms.relrowsecurity,
        'rooms_force_rls', rooms.relforcerowsecurity,
        'scenes_rls', scenes.relrowsecurity,
        'jobs_rls', jobs.relrowsecurity,
        'room_triggers', (
          select coalesce(json_agg(tg.tgname order by tg.tgname), '[]'::json)
          from pg_trigger tg
          where tg.tgrelid = rooms.oid and not tg.tgisinternal
        )
      )
      from pg_proc fn
      join pg_namespace ns on ns.oid = fn.pronamespace
      join pg_class rooms on rooms.relname = 'vibode_rooms' and rooms.relnamespace = ns.oid
      join pg_class scenes on scenes.relname = 'vibode_3d_scenes' and scenes.relnamespace = ns.oid
      join pg_class jobs on jobs.relname = 'vibode_harmonize_generations' and jobs.relnamespace = ns.oid
      where ns.nspname = 'public' and fn.proname = 'publish_vibode_harmonize_history'
    `);
    assert.equal(installed.function_owner, "postgres");
    assert.equal(installed.security_definer, true);
    assert.equal(installed.rooms_owner, "postgres");
    assert.equal(installed.rooms_rls, true);
    assert.equal(installed.rooms_force_rls, false);
    assert.equal(installed.scenes_rls, true);
    assert.equal(installed.jobs_rls, true);
    assert.deepEqual(installed.room_triggers, [
      "protect_current_afc_generation_id",
      "set_timestamp_vibode_rooms",
    ]);
    const triggerBodies = await psql(`
      select string_agg(proname || ':' || prosrc, E'\\n')
      from pg_proc
      where proname in ('set_timestamp', 'protect_current_afc_generation_id')
    `);
    assert.match(triggerBodies, /set_timestamp:[\s\S]*return new/);
    assert.match(triggerBodies, /protect_current_afc_generation_id:[\s\S]*return new/);
    assert.doesNotMatch(triggerBodies, /return null/i);

    const matched = await publishFixture({ name: "all conditions match", expect: "activated" });
    assert.equal(matched.kind, "activated", JSON.stringify(matched.summary));
    assert.equal(matched.summary.assetCount, 1);
    assert.equal(matched.summary.runCount, 1);
    assert.equal(matched.summary.sceneCount, 1);
    assert.equal(matched.summary.sceneUnchanged, true);
    assert.equal(matched.summary.afcUnchanged, true);
    assert.equal(matched.summary.scaleUnchanged, true);
    assert.equal(matched.summary.pointerIsOutput, true);
    assert.equal(matched.summary.outputActive, true);
    assert.equal(matched.summary.sourceActive, false);
    assert.equal(matched.summary.scaleType, "number");
    const repeat = await publish(matched.seed.jobId);
    assert.equal(repeat.code, "already_published");
    assert.equal(repeat.activated, false);
    assert.equal(await count(`select count(*) from public.vibode_room_assets where harmonize_job_id = '${matched.seed.jobId}'`), 1);
    assert.equal(await count(`select count(*) from public.vibode_generation_runs where harmonize_job_id = '${matched.seed.jobId}'`), 1);
    assert.equal((await roomPointer(matched.seed.roomId)), matched.summary.outputId);

    const cases: Fixture[] = [
      { name: "room scale differs", expect: "inactive", roomScale: 1.5 },
      { name: "saved scene objects differ", expect: "inactive", scene: "moved" },
      { name: "swapped scene objects differ", expect: "inactive", scene: "swapped" },
      { name: "current active asset differs", expect: "inactive", active: "other" },
      { name: "current active asset is null", expect: "inactive", active: "null" },
      { name: "current AFC generation differs", expect: "inactive", roomAfc: "other" },
      { name: "current AFC generation is null", expect: "inactive", roomAfc: "null" },
      { name: "source scene is missing", expect: "inactive", scene: "missing" },
      { name: "source scene AFC differs", expect: "inactive", sceneAfc: "other" },
      { name: "source scene owner differs", expect: "inactive", sceneUser: "other" },
      { name: "source asset belongs to another room", expect: "rejected", code: "source_mismatch", source: "other-room" },
      { name: "source asset was deleted", expect: "inactive", source: "deleted" },
      { name: "source version is null", expect: "inactive", source: "null" },
      { name: "job user does not own the room", expect: "rejected", code: "not_found", jobUser: "other" },
      { name: "scale snapshot is missing", expect: "inactive", omitScale: true },
      { name: "scale snapshot is a json string", expect: "inactive", snapshotScale: "0.94" },
      { name: "scale snapshot is null", expect: "inactive", snapshotScale: null },
      { name: "scale snapshot is below 0.25", expect: "inactive", snapshotScale: 0.24 },
      { name: "scale snapshot is above 2", expect: "inactive", snapshotScale: 2.01 },
      { name: "scale boundary 0.25", expect: "activated", roomScale: 0.25, snapshotScale: 0.25 },
      { name: "scale boundary 2.00", expect: "activated", roomScale: 2, snapshotScale: 2 },
      { name: "json numeric text 1 and 1.0", expect: "activated", scene: "numeric-text" },
      { name: "json number differs from numeric string", expect: "inactive", scene: "string-number" },
      { name: "both scene sides use the same numeric string", expect: "activated", scene: "both-strings" },
    ];
    for (const item of cases) {
      const result = await publishFixture(item);
      assert.equal(result.kind, item.expect, `${item.name} ${JSON.stringify(result.summary)}`);
      if (item.code) assert.equal(result.summary.code, item.code, item.name);
      if (item.expect === "inactive") {
        assert.equal(result.summary.outputActive, false, item.name);
        assert.equal(result.summary.pointerIsOutput, false, item.name);
      }
      if (item.expect === "rejected") {
        assert.equal(result.summary.assetCount, 0, item.name);
        assert.equal(result.summary.historyState, "pending", item.name);
      }
    }

    const stringScale = await publishFixture({
      name: "string scale still compares equal after publication",
      expect: "inactive",
      snapshotScale: "0.94",
    });
    const stringProbe = await readJson(`
      select json_build_object(
        'type', jsonb_typeof(snapshot->'roomScaleMultiplier'),
        'text', snapshot->>'roomScaleMultiplier',
        'column_equals_text', room.room_scale_multiplier = (job.snapshot->>'roomScaleMultiplier')::double precision,
        'activated_column', asset.is_active,
        'pointer_is_source', room.active_asset_id = job.source_version_id
      )
      from public.vibode_harmonize_generations job
      join public.vibode_rooms room on room.id = job.room_id
      join public.vibode_room_assets asset on asset.id = job.output_asset_id
      where job.id = '${stringScale.seed.jobId}'
    `);
    assert.equal(stringProbe.type, "string");
    assert.equal(stringProbe.text, "0.94");
    assert.equal(stringProbe.column_equals_text, true);
    assert.equal(stringProbe.activated_column, false);
    assert.equal(stringProbe.pointer_is_source, true);

    const restoredScene = await divergeThenRestore("scene");
    assert.equal(restoredScene.during.activated, false);
    assert.equal(restoredScene.afterMatch, true);
    assert.equal(restoredScene.outputActive, false);
    const restoredScale = await divergeThenRestore("scale");
    assert.equal(restoredScale.during.activated, false);
    assert.equal(restoredScale.afterMatch, true);
    const restoredAfc = await divergeThenRestore("afc");
    assert.equal(restoredAfc.during.activated, false);
    assert.equal(restoredAfc.afterMatch, true);

    const hidden = await uncommittedSceneChange();
    assert.equal(hidden.during.activated, true);
    assert.equal(hidden.afterMatch, false);
    assert.equal(hidden.outputActive, true);

    const raced = await concurrentActivation();
    assert.equal(raced.filter((item) => item.activated === true).length, 1);
    assert.equal(raced.filter((item) => item.code === "published").length, 2);

    const cancelled = await cancellingTrigger();
    assert.equal(cancelled.during.activated, false);
    assert.equal(cancelled.during.code, "published");
    assert.equal(cancelled.afterMatch, true);
    assert.equal(cancelled.outputActive, false);
    const afterCancel = await publishFixture({ name: "real triggers still activate", expect: "activated" });
    assert.equal(afterCancel.kind, "activated");

    const denied = await nonOwnerDefiner();
    assert.equal(denied.code, "not_found");
    assert.equal(denied.assetCount, 0);
    assert.equal(denied.historyState, "pending");
    const ownerAgain = await publishFixture({ name: "table owner sees the scene through rls", expect: "activated" });
    assert.equal(ownerAgain.kind, "activated");

    const service = await publishFixture({
      name: "service role executes the definer",
      expect: "activated",
      asServiceRole: true,
    });
    assert.equal(service.kind, "activated", JSON.stringify(service.summary));
  } finally {
    await removeContainer();
  }
});

async function publishFixture(input: Fixture): Promise<Readonly<{ kind: Kind; seed: Seed; summary: Json }>> {
  const seed = await seedFixture(input);
  const published = await publish(seed.jobId, input.asServiceRole === true);
  const summary = await summarize(seed, published);
  return { kind: classify(published, summary), seed, summary };
}

function classify(published: Json, summary: Json): Kind {
  if (published.code === "published" && published.activated === true && summary.outputActive === true) return "activated";
  if (published.code === "published" && published.activated === false) return "inactive";
  return "rejected";
}

async function seedFixture(input: Fixture): Promise<Seed> {
  const roomId = nextId("b");
  const sourceId = nextId("c");
  const otherAssetId = nextId("c");
  const generationId = nextId("d");
  const otherGenerationId = nextId("d");
  const jobId = nextId("e");
  const roomScale = input.roomScale ?? 0.94;
  const jobUser = input.jobUser === "other" ? OTHER : USER;
  const sceneUser = input.sceneUser === "other" ? OTHER : USER;
  const sceneGeneration = input.sceneAfc === "other" ? otherGenerationId : generationId;
  const canonical = JSON.stringify(SCENE);
  const stored = storedScene(input.scene, canonical);
  const snapshot = snapshotJson(input);
  const sourceRoom = input.source === "other-room" ? nextId("b") : roomId;
  const sourceVersion = input.source === "null" ? null : sourceId;

  await psql(`
    insert into public.vibode_rooms (id, user_id, title, room_scale_multiplier, current_stage)
    values ('${roomId}', '${USER}', 'forensic', ${roomScale}, 3);
    ${input.source === "other-room" ? `insert into public.vibode_rooms (id, user_id, title) values ('${sourceRoom}', '${USER}', 'other');` : ""}
    insert into public.vibode_afc_generations (
      id, room_id, user_id, run_id, intent, status, production_authority
    ) values (
      '${generationId}', '${roomId}', '${USER}', '${generationId}', 'analyze', 'ready',
      '{"marker":"authority","generationId":"${generationId}"}'::jsonb
    );
    insert into public.vibode_room_assets (
      id, room_id, user_id, asset_type, image_url, is_active, stage_number, width, height
    ) values (
      '${sourceId}', '${sourceRoom}', '${USER}', 'base', '', true, 3, 1264, 848
    );
    insert into public.vibode_room_assets (
      id, room_id, user_id, asset_type, image_url, is_active, stage_number
    ) values (
      '${otherAssetId}', '${roomId}', '${USER}', 'base', '', false, 3
    );
  `);
  if (input.sceneAfc === "other" || input.roomAfc === "other") {
    await psql(`
      insert into public.vibode_afc_generations (
        id, room_id, user_id, run_id, intent, status, production_authority
      ) values (
        '${otherGenerationId}', '${roomId}', '${USER}', '${otherGenerationId}', 'analyze', 'ready',
        '{"marker":"other"}'::jsonb
      );
    `);
  }
  const roomAfc = input.roomAfc === "null"
    ? "null"
    : `'${input.roomAfc === "other" ? otherGenerationId : generationId}'`;
  const active = input.active === "null"
    ? "null"
    : `'${input.active === "other" ? otherAssetId : sourceId}'`;
  await psql(`
    update public.vibode_rooms
      set active_asset_id = ${active},
          current_afc_generation_id = ${roomAfc}
    where id = '${roomId}';
  `);
  if (input.scene !== "missing" && input.source !== "other-room") {
    await psql(`
      insert into public.vibode_3d_scenes (
        room_id, version_id, user_id, afc_generation_id, objects_json
      ) values (
        '${roomId}', '${sourceId}', '${sceneUser}', '${sceneGeneration}', ${stored}
      );
    `);
  }
  const jobObjects = input.scene === "both-strings" ? stored : `${quote(canonical)}::jsonb`;
  await psql(`
    insert into public.vibode_harmonize_generations (
      id, user_id, room_id, source_version_id, idempotency_key, kind, status,
      request_sha256, scene_snapshot_sha256, background_sha256, composite_sha256, prompt_sha256,
      prompt_version, assembly_version, afc_generation_id, snapshot,
      composite_path, composite_byte_length, composite_width, composite_height,
      output_bucket, output_path, output_sha256, output_mime, output_width, output_height,
      provider_started_at, provider_attempt_id, returned_model_id, backdrop_kind, scene_objects,
      history_state, completed_at
    ) values (
      '${jobId}', '${jobUser}', '${roomId}', ${sourceVersion ? `'${sourceVersion}'` : "null"}, '${jobId}', 'initial', 'succeeded',
      '${SHA}', '${SHA}', '${SHA}', '${SHA}', '${SHA}',
      'harmonize-universal-prompt/2.0', 'harmonize-prompt-assembly/1', '${generationId}',
      ${quote(JSON.stringify(snapshot))}::jsonb,
      'rooms/${roomId}/intakes/${jobUser}/${jobId}/composite.png', 1000, 1264, 848,
      'vibode-harmonize', 'rooms/${roomId}/jobs/${jobId}/output.jpg', '${SHA}', 'image/jpeg', 2528, 1696,
      now(), gen_random_uuid(), 'fake-harmonize', 'afc_original', ${jobObjects},
      'pending', now()
    );
  `);
  if (input.source === "deleted") {
    await psql(`delete from public.vibode_room_assets where id = '${sourceId}'`);
  }
  const sceneText = input.scene === "missing" || input.source === "deleted" || input.source === "other-room"
    ? ""
    : await psql(`select objects_json::text from public.vibode_3d_scenes where version_id = '${sourceId}'`);
  const afcText = await psql(`select status || ':' || production_authority::text from public.vibode_afc_generations where id = '${generationId}'`);
  jobRoom.set(jobId, roomId);
  return { jobId, roomId, sourceId, generationId, sceneText, roomScale, afcText };
}

function storedScene(scene: Fixture["scene"], canonical: string): string {
  if (scene === "moved") {
    const moved = structuredClone(SCENE);
    moved[0] = {
      ...moved[0],
      transform: { ...moved[0].transform, position: { ...moved[0].transform.position, x: 9 } },
    };
    return `${quote(JSON.stringify(moved))}::jsonb`;
  }
  if (scene === "swapped") return `${quote(JSON.stringify([SCENE[1], SCENE[0]]))}::jsonb`;
  if (scene === "string-number") {
    const changed = JSON.parse(canonical) as Array<{ transform: { uniformScale: number | string } }>;
    changed[0].transform.uniformScale = "0.94";
    return `${quote(JSON.stringify(changed))}::jsonb`;
  }
  if (scene === "both-strings") {
    const changed = JSON.parse(canonical) as Array<{ transform: { uniformScale: number | string } }>;
    changed[1].transform.uniformScale = "0.94";
    return `${quote(JSON.stringify(changed))}::jsonb`;
  }
  if (scene === "numeric-text") return `'${canonical.replace('"uniformScale":1,', '"uniformScale":1.0,')}'::jsonb`;
  return `${quote(JSON.stringify(reorder(JSON.parse(canonical))))}::jsonb`;
}

function snapshotJson(input: Fixture): Json {
  const snapshot: Json = { prompt: "forensic" };
  if (!input.omitScale) {
    snapshot.roomScaleMultiplier = input.snapshotScale === undefined ? 0.94 : input.snapshotScale;
  }
  return snapshot;
}

async function summarize(seed: Seed, published: Json): Promise<Json> {
  const assetId = typeof published.assetId === "string" ? published.assetId : "";
  const room = await readJson(`
    select json_build_object(
      'active_asset_id', active_asset_id,
      'current_afc_generation_id', current_afc_generation_id,
      'room_scale_multiplier', room_scale_multiplier,
      'current_stage', current_stage
    ) from public.vibode_rooms where id = '${seed.roomId}'
  `);
  const job = await readJson(`
    select json_build_object(
      'history_state', history_state,
      'output_asset_id', output_asset_id,
      'source_version_id', source_version_id,
      'scale_type', jsonb_typeof(snapshot->'roomScaleMultiplier')
    ) from public.vibode_harmonize_generations where id = '${seed.jobId}'
  `);
  const outputActive = assetId
    ? await psql(`select is_active::text from public.vibode_room_assets where id = '${assetId}'`)
    : "";
  const sourceActive = await psql(`select coalesce((select is_active::text from public.vibode_room_assets where id = '${seed.sourceId}'), 'missing')`);
  const sceneNow = await psql(`select coalesce((select objects_json::text from public.vibode_3d_scenes where version_id = '${seed.sourceId}'), '')`);
  const afc = await psql(`select status || ':' || production_authority::text from public.vibode_afc_generations where id = '${seed.generationId}'`);
  return {
    code: published.code,
    activated: published.activated,
    assetCount: await count(`select count(*) from public.vibode_room_assets where harmonize_job_id = '${seed.jobId}'`),
    runCount: await count(`select count(*) from public.vibode_generation_runs where harmonize_job_id = '${seed.jobId}'`),
    sceneCount: await count(`select count(*) from public.vibode_3d_scenes where room_id = '${seed.roomId}'`),
    historyState: job.history_state,
    outputActive: outputActive === "true",
    sourceActive: sourceActive === "true",
    pointerIsOutput: assetId !== "" && room.active_asset_id === assetId,
    sceneUnchanged: sceneNow === seed.sceneText,
    afcUnchanged: afc === seed.afcText,
    scaleUnchanged: (await psql(`select (room_scale_multiplier = ${seed.roomScale}::double precision)::text from public.vibode_rooms where id = '${seed.roomId}'`)) === "true",
    outputId: assetId,
    scaleType: job.scale_type,
    afcId: room.current_afc_generation_id,
    stage: room.current_stage,
  };
}

async function divergeThenRestore(kind: "scene" | "scale" | "afc"): Promise<Readonly<{
  during: Json;
  afterMatch: boolean;
  outputActive: boolean;
}>> {
  const seed = await seedFixture({ name: kind, expect: "activated" });
  const holder = hold(84001);
  try {
    await waitFor(grantedAdvisory(84001), "asset pause holder");
    await installPause("asset");
    const pending = publish(seed.jobId);
    await waitFor(waitingAdvisory(84001), "asset insert pause");
    if (kind === "scene") {
      await psql(`update public.vibode_3d_scenes set objects_json = '[{"objectId":"changed"}]'::jsonb where version_id = '${seed.sourceId}'`);
    } else if (kind === "scale") {
      await psql(`update public.vibode_rooms set room_scale_multiplier = 1.5 where id = '${seed.roomId}'`);
    } else {
      const other = nextId("d");
      await psql(`
        insert into public.vibode_afc_generations (id, room_id, user_id, run_id, intent, status)
        values ('${other}', '${seed.roomId}', '${USER}', '${other}', 'analyze', 'ready');
        update public.vibode_rooms set current_afc_generation_id = '${other}' where id = '${seed.roomId}';
      `);
    }
    await release(84001);
    const during = await pending;
    await holder;
    if (kind === "scene") {
      await psql(`update public.vibode_3d_scenes set objects_json = ${quote(JSON.stringify(SCENE))}::jsonb where version_id = '${seed.sourceId}'`);
    } else if (kind === "scale") {
      await psql(`update public.vibode_rooms set room_scale_multiplier = 0.94 where id = '${seed.roomId}'`);
    } else {
      await psql(`update public.vibode_rooms set current_afc_generation_id = '${seed.generationId}' where id = '${seed.roomId}'`);
    }
    const afterMatch = await predicatesMatch(seed);
    const outputActive = await psql(`select coalesce((select is_active::text from public.vibode_room_assets where id = '${String(during.assetId)}'), 'false')`);
    return { during, afterMatch, outputActive: outputActive === "true" };
  } finally {
    await psql("drop trigger if exists forensic_pause_asset on public.vibode_room_assets");
    await release(84001);
    await holder.catch(() => undefined);
  }
}

async function uncommittedSceneChange(): Promise<Readonly<{
  during: Json;
  afterMatch: boolean;
  outputActive: boolean;
}>> {
  const seed = await seedFixture({ name: "uncommitted scene", expect: "activated" });
  const holder = hold(85002);
  try {
    await waitFor(grantedAdvisory(85002), "uncommitted gate");
    const writer = psql(`
      begin;
      update public.vibode_3d_scenes
        set objects_json = '[{"objectId":"uncommitted"}]'::jsonb
      where version_id = '${seed.sourceId}';
      select pg_advisory_lock(85002);
      commit;
    `);
    await waitFor(waitingAdvisory(85002), "uncommitted scene update");
    const during = await publish(seed.jobId);
    assert.equal(await sceneMatches(seed), true);
    await release(85002);
    await writer;
    await holder;
    return {
      during,
      afterMatch: await sceneMatches(seed),
      outputActive: (await psql(`select is_active::text from public.vibode_room_assets where id = '${String(during.assetId)}'`)) === "true",
    };
  } finally {
    await release(85002);
    await holder.catch(() => undefined);
  }
}

async function concurrentActivation(): Promise<Json[]> {
  const first = await seedFixture({ name: "concurrent a", expect: "activated" });
  const second = await seedSibling(first);
  const holder = hold(84002);
  try {
    await waitFor(grantedAdvisory(84002), "room pause holder");
    await installPause("room");
    const left = publish(first.jobId);
    await waitFor(waitingAdvisory(84002), "first room update");
    const right = publish(second.jobId);
    await waitFor(`
      select case when count(*) >= 2 then 1 else 0 end
      from pg_stat_activity
      where datname = 'harmonize'
        and state = 'active'
        and pid <> pg_backend_pid()
        and query like '%publish_vibode_harmonize_history%'
    `, "second publication");
    await release(84002);
    const results = [await left, await right];
    await holder;
    return results;
  } finally {
    await psql("drop trigger if exists forensic_pause_room on public.vibode_rooms");
    await release(84002);
    await holder.catch(() => undefined);
  }
}

async function cancellingTrigger(): Promise<Readonly<{ during: Json; afterMatch: boolean; outputActive: boolean }>> {
  const seed = await seedFixture({ name: "cancelling trigger", expect: "inactive" });
  await psql(`
    create or replace function public.forensic_cancel_room_update()
    returns trigger language plpgsql as $$ begin return null; end $$;
    create trigger forensic_cancel_room_update
    before update on public.vibode_rooms
    for each row execute function public.forensic_cancel_room_update();
  `);
  try {
    const during = await publish(seed.jobId);
    return {
      during,
      afterMatch: await predicatesMatch(seed),
      outputActive: false,
    };
  } finally {
    await psql("drop trigger if exists forensic_cancel_room_update on public.vibode_rooms");
  }
}

async function nonOwnerDefiner(): Promise<Readonly<{ code: string; assetCount: number; historyState: string }>> {
  const seed = await seedFixture({ name: "non owner definer", expect: "rejected" });
  await psql(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'forensic_subject') then
        create role forensic_subject nologin nosuperuser nobypassrls;
      end if;
    end $$;
    grant usage on schema public to forensic_subject;
    grant select, insert, update, delete on all tables in schema public to forensic_subject;
    alter function public.publish_vibode_harmonize_history(uuid, text, text, text) owner to forensic_subject;
  `);
  try {
    const published = await publish(seed.jobId);
    return {
      code: String(published.code),
      assetCount: await count(`select count(*) from public.vibode_room_assets where harmonize_job_id = '${seed.jobId}'`),
      historyState: await psql(`select history_state from public.vibode_harmonize_generations where id = '${seed.jobId}'`),
    };
  } finally {
    await psql("alter function public.publish_vibode_harmonize_history(uuid, text, text, text) owner to postgres");
  }
}

async function seedSibling(base: Seed): Promise<Seed> {
  const jobId = nextId("e");
  const canonical = JSON.stringify(SCENE);
  await psql(`
    insert into public.vibode_harmonize_generations (
      id, user_id, room_id, source_version_id, idempotency_key, kind, status,
      request_sha256, scene_snapshot_sha256, background_sha256, composite_sha256, prompt_sha256,
      prompt_version, assembly_version, afc_generation_id, snapshot,
      composite_path, composite_byte_length, composite_width, composite_height,
      output_bucket, output_path, output_sha256, output_mime, output_width, output_height,
      provider_started_at, provider_attempt_id, returned_model_id, backdrop_kind, scene_objects,
      history_state, completed_at
    ) values (
      '${jobId}', '${USER}', '${base.roomId}', '${base.sourceId}', '${jobId}', 'initial', 'succeeded',
      '${SHA}', '${SHA}', '${SHA}', '${SHA}', '${SHA}',
      'harmonize-universal-prompt/2.0', 'harmonize-prompt-assembly/1', '${base.generationId}',
      '{"prompt":"forensic","roomScaleMultiplier":0.94}'::jsonb,
      'rooms/${base.roomId}/intakes/${USER}/${jobId}/composite.png', 1000, 1264, 848,
      'vibode-harmonize', 'rooms/${base.roomId}/jobs/${jobId}/output.jpg', '${SHA}', 'image/jpeg', 2528, 1696,
      now(), gen_random_uuid(), 'fake-harmonize', 'afc_original', ${quote(canonical)}::jsonb,
      'pending', now()
    );
  `);
  jobRoom.set(jobId, base.roomId);
  return { ...base, jobId };
}

async function sceneMatches(seed: Seed): Promise<boolean> {
  return (await count(`
    select count(*)
    from public.vibode_3d_scenes scene
    join public.vibode_harmonize_generations job on job.source_version_id = scene.version_id
    where job.id = '${seed.jobId}'
      and scene.objects_json = job.scene_objects
  `)) === 1;
}

async function predicatesMatch(seed: Seed): Promise<boolean> {
  const countMatch = await count(`
    select count(*)
    from public.vibode_harmonize_generations job
    join public.vibode_rooms room on room.id = job.room_id
    where job.id = '${seed.jobId}'
      and room.user_id = job.user_id
      and room.active_asset_id is not distinct from job.source_version_id
      and room.current_afc_generation_id is not distinct from job.afc_generation_id
      and room.room_scale_multiplier = (job.snapshot->>'roomScaleMultiplier')::double precision
      and exists (
        select 1 from public.vibode_3d_scenes scene
        where scene.room_id = job.room_id
          and scene.version_id = job.source_version_id
          and scene.user_id = job.user_id
          and scene.afc_generation_id = job.afc_generation_id
          and scene.objects_json = job.scene_objects
      )
  `);
  return countMatch === 1;
}

async function installPause(target: "asset" | "room"): Promise<void> {
  if (target === "asset") {
    await psql(`
      create or replace function public.forensic_pause_asset()
      returns trigger language plpgsql as $$
      begin
        perform pg_advisory_lock(84001);
        perform pg_advisory_unlock(84001);
        return new;
      end $$;
      drop trigger if exists forensic_pause_asset on public.vibode_room_assets;
      create trigger forensic_pause_asset
      before insert on public.vibode_room_assets
      for each row execute function public.forensic_pause_asset();
    `);
    return;
  }
  await psql(`
    create or replace function public.forensic_pause_room()
    returns trigger language plpgsql as $$
    begin
      perform pg_advisory_lock(84002);
      perform pg_advisory_unlock(84002);
      return new;
    end $$;
    drop trigger if exists forensic_pause_room on public.vibode_rooms;
    create trigger forensic_pause_room
    before update on public.vibode_rooms
    for each row execute function public.forensic_pause_room();
  `);
}

async function publish(jobId: string, asServiceRole = false): Promise<Json> {
  const role = asServiceRole ? "set role service_role;" : "";
  return call(`
    ${role}
    select public.publish_vibode_harmonize_history(
      '${jobId}', '${SHA}', 'vibode-generations', 'rooms/${jobIdRoom(jobId)}/harmonize/${jobId}.jpg'
    );
  `);
}

function hold(key: number): Promise<string> {
  // The loop only watches for a committed signal row. Callers proceed when
  // pg_locks shows the other session waiting, not when a timer expires.
  return (async () => {
    await psql(`delete from public.forensic_signal where key = ${key}`);
    return psql(`
      select pg_advisory_lock(${key});
      do $hold$
      begin
        loop
          exit when exists (select 1 from public.forensic_signal where key = ${key});
          perform pg_sleep(0.05);
        end loop;
      end
      $hold$;
      select pg_advisory_unlock(${key});
    `);
  })();
}

async function release(key: number): Promise<void> {
  await psql(`insert into public.forensic_signal (key) values (${key}) on conflict do nothing`);
}

function grantedAdvisory(key: number): string {
  return `select count(*) from pg_locks where locktype = 'advisory' and objid = ${key} and granted`;
}

function waitingAdvisory(key: number): string {
  return `select count(*) from pg_locks where locktype = 'advisory' and objid = ${key} and not granted`;
}

function jobIdRoom(jobId: string): string {
  return jobRoom.get(jobId) ?? "";
}

const jobRoom = new Map<string, string>();

async function roomPointer(roomId: string): Promise<string> {
  return psql(`select active_asset_id::text from public.vibode_rooms where id = '${roomId}'`);
}

function nextId(kind: "b" | "c" | "d" | "e"): string {
  seq += 1;
  const tail = seq.toString(16).padStart(12, "0");
  const prefix = {
    b: "bbbbbbbb-bbbb-4bbb-8bbb-",
    c: "cccccccc-cccc-4ccc-8ccc-",
    d: "dddddddd-dddd-4ddd-8ddd-",
    e: "eeeeeeee-eeee-4eee-8eee-",
  }[kind];
  return prefix + tail;
}

function reorder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorder);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([key, item]) => [key, reorder(item)]));
  }
  return value;
}

async function applyMigrations(): Promise<void> {
  await psql(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema if not exists auth;
    create table auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create or replace function auth.role() returns text
    language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role')
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    grant execute on function auth.role() to anon, authenticated, service_role;
    create schema if not exists storage;
    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text,
      name text
    );
    alter table storage.objects enable row level security;
    grant usage on schema storage, public to anon, authenticated, service_role;
  `);
  for (const file of MIGRATIONS) {
    try {
      await psql(readFileSync(path.join(process.cwd(), "supabase/migrations", file), "utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${file}\n${message}`);
    }
  }
}

async function waitFor(sql: string, label: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = await psql(sql);
    if (Number(value) > 0) return;
    await delay(100);
  }
  const activity = await psql(`
    select coalesce(string_agg(state || ':' || coalesce(wait_event_type, '') || ':' || coalesce(wait_event, ''), ' | '), 'none')
    from pg_stat_activity where datname = 'harmonize'
  `);
  throw new Error(`timed out waiting for ${label}: ${activity}`);
}

async function count(sql: string): Promise<number> {
  return Number(await psql(sql));
}

async function readJson(sql: string): Promise<Json> {
  return JSON.parse(await psql(sql)) as Json;
}

async function call(sql: string): Promise<Json> {
  const text = (await psql(sql)).split("\n").map((item) => item.trim()).find((item) => item.startsWith("{"));
  if (!text) throw new Error(`no json from publication`);
  return JSON.parse(text) as Json;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function startPostgres(): Promise<void> {
  const started = await docker([
    "run", "-d", "--rm", "--name", CONTAINER,
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
    "-e", "POSTGRES_DB=harmonize",
    "postgres:16-alpine",
  ]);
  if (started.code !== 0) throw new Error(started.stderr || started.stdout);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logs = await docker(["logs", CONTAINER]);
    if (`${logs.stdout}\n${logs.stderr}`.includes("PostgreSQL init process complete")) {
      const probe = await docker([
        "exec", CONTAINER, "psql", "-U", "postgres", "-d", "harmonize", "-t", "-A", "-c", "select 1",
      ]);
      if (probe.code === 0 && probe.stdout.trim() === "1") return;
    }
    await delay(500);
  }
  const logs = await docker(["logs", CONTAINER]);
  throw new Error(`disposable postgres 16 did not become ready\n${logs.stdout}\n${logs.stderr}`);
}

async function psql(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "harmonize", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-q",
  ], sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

async function removeContainer(): Promise<void> {
  await docker(["rm", "-f", CONTAINER]);
}

function docker(args: string[], input?: string): Promise<Readonly<{ code: number; stdout: string; stderr: string }>> {
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
