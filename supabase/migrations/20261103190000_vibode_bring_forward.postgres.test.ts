/**
 * Bring Forward snapshot and selection tables.
 *
 * Applies only this migration to a disposable local Postgres 16 container.
 * Docker is required. The test does not skip and does not connect to hosted
 * Supabase.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import {
  acceptBringForwardSnapshot,
  canonicalBringForwardSnapshot,
} from "@/lib/vibode-stage/bring-forward-store";
import { packRemoveMask, type RemoveObjectRecord } from "@/lib/vibode-stage/remove-objects";

const CONTAINER = "bring-forward-pg";
const DATABASE = "bringforward";
const MIGRATION = "supabase/migrations/20261103190000_vibode_bring_forward.sql";
const USER = "11111111-1111-4111-8111-111111111111";
const ROOM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const OTHER_ROOM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const GENERATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const WIDTH = 32;
const HEIGHT = 32;
const ORIGINAL_SHA = "ab".repeat(32);

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function packed(paint: (x: number, y: number) => boolean) {
  const coverage = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (paint(x, y)) coverage[y * WIDTH + x] = 255;
    }
  }
  const mask = packRemoveMask(coverage, WIDTH, HEIGHT);
  assert.ok(mask);
  return mask;
}

function record(id: string, paint: (x: number, y: number) => boolean): RemoveObjectRecord {
  const mask = packed(paint);
  return {
    id,
    concept: id,
    confidence: 0.9,
    mask,
    eligibility: {
      eligible: true,
      reasons: [],
      notices: [],
      confidence: 0.9,
      areaPx: mask.areaPx,
      areaFraction: mask.areaPx / (WIDTH * HEIGHT),
      edgeTouches: 0,
      bounds: mask.bounds,
    },
  };
}

test("bring forward persistence holds on a disposable database", { timeout: 180_000 }, async () => {
  const dockerProbe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (dockerProbe.status !== 0 || dockerProbe.stdout.trim().length === 0) {
    throw new Error(`disposable postgres requires Docker\n${dockerProbe.stderr}`);
  }

  const migration = source(MIGRATION);
  assert.match(migration, /vibode_rooms\.metadata document is not updated/);
  assert.doesNotMatch(migration, /update public\.vibode_rooms|insert into storage\.buckets|create policy /i);

  const canonical = canonicalBringForwardSnapshot({
    identity: {
      roomId: ROOM,
      generationId: GENERATION,
      originalSha256: ORIGINAL_SHA,
      originalWidth: WIDTH,
      originalHeight: HEIGHT,
    },
    conceptSet: "remove-segmentation-concepts/v1",
    provider: "stored",
    modelId: "sam3",
    objects: [record("sofa", (x) => x < 16), record("lamp", (x) => x >= 16)],
  });
  assert.ok(canonical);
  assert.equal(canonical.includes("$bf$"), false);
  const payloadSha = sha256(canonical);
  assert.equal(payloadSha, sha256Hex(new TextEncoder().encode(canonical)));

  await removeContainer();
  try {
    await startPostgres();
    await psql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema if not exists auth;
      create table auth.users (id uuid primary key);
      insert into auth.users (id) values ('${USER}');
      grant usage on schema public to anon, authenticated, service_role;
      create table public.vibode_rooms (
        id uuid primary key,
        user_id uuid not null references auth.users(id) on delete cascade,
        title text not null default 'Untitled Room',
        metadata jsonb not null default '{}'::jsonb
      );
      insert into public.vibode_rooms (id, user_id, title, metadata)
      values
        ('${ROOM}', '${USER}', 'Disposable room', '{"activeSetVersionId":"keep-me"}'::jsonb),
        ('${OTHER_ROOM}', '${USER}', 'Cascade room', '{}'::jsonb);
    `);

    const roomShape = await psql(`
      select column_name || ':' || data_type
      from information_schema.columns
      where table_schema = 'public' and table_name = 'vibode_rooms'
      order by ordinal_position
    `);
    const roomPolicies = await psql(`
      select count(*) from pg_policy where polrelid = 'public.vibode_rooms'::regclass
    `);

    await psql(migration);

    assert.equal(await psql(`
      select column_name || ':' || data_type
      from information_schema.columns
      where table_schema = 'public' and table_name = 'vibode_rooms'
      order by ordinal_position
    `), roomShape);
    assert.equal(await psql(`
      select count(*) from pg_policy where polrelid = 'public.vibode_rooms'::regclass
    `), roomPolicies);
    assert.equal(await psql(`select metadata->>'activeSetVersionId' from public.vibode_rooms where id = '${ROOM}'`), "keep-me");
    assert.equal(await psql(`select count(*) from pg_namespace where nspname = 'storage'`), "0");

    const tables = await psql(`
      select c.relname || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('vibode_bring_forward_snapshots', 'vibode_bring_forward_selections')
      order by c.relname
    `);
    assert.equal(
      tables,
      [
        "vibode_bring_forward_selections:true:false",
        "vibode_bring_forward_snapshots:true:false",
      ].join("\n"),
    );
    assert.equal(await psql(`
      select count(*) from pg_policy
      where polrelid in (
        'public.vibode_bring_forward_snapshots'::regclass,
        'public.vibode_bring_forward_selections'::regclass
      )
    `), "0");
    assert.equal(await psql(`
      select grantee || ':' || table_name || ':' || privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name in ('vibode_bring_forward_snapshots', 'vibode_bring_forward_selections')
        and grantee <> 'postgres'
      order by 1
    `), [
      "service_role:vibode_bring_forward_selections:DELETE",
      "service_role:vibode_bring_forward_selections:INSERT",
      "service_role:vibode_bring_forward_selections:SELECT",
      "service_role:vibode_bring_forward_selections:UPDATE",
      "service_role:vibode_bring_forward_snapshots:DELETE",
      "service_role:vibode_bring_forward_snapshots:INSERT",
      "service_role:vibode_bring_forward_snapshots:SELECT",
      "service_role:vibode_bring_forward_snapshots:UPDATE",
    ].join("\n"));
    assert.equal(await psql(`
      select count(*)
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name in ('vibode_bring_forward_snapshots', 'vibode_bring_forward_selections')
        and grantee in ('anon', 'authenticated', 'public')
    `), "0");

    await psql(`
      alter role anon login;
      alter role authenticated login;
      alter role service_role login;
    `);

    for (const role of ["anon", "authenticated"]) {
      for (const table of ["vibode_bring_forward_snapshots", "vibode_bring_forward_selections"]) {
        assert.match(await psqlErrorAs(role, `select * from public.${table}`), /permission denied/i, `${role} select ${table}`);
        assert.match(await psqlErrorAs(role, `insert into public.${table} default values`), /permission denied/i, `${role} insert ${table}`);
        assert.match(await psqlErrorAs(role, `update public.${table} set user_id = user_id`), /permission denied/i, `${role} update ${table}`);
        assert.match(await psqlErrorAs(role, `delete from public.${table}`), /permission denied/i, `${role} delete ${table}`);
      }
    }

    await psql(`
      grant select, insert, update, delete on table public.vibode_bring_forward_snapshots to authenticated;
      grant select, insert, update, delete on table public.vibode_bring_forward_selections to authenticated;
    `);
    assert.equal(await psqlAs("authenticated", `select count(*) from public.vibode_bring_forward_snapshots`), "0");
    assert.match(await psqlErrorAs("authenticated", `
      insert into public.vibode_bring_forward_snapshots (
        room_id, user_id, generation_id, original_sha256, original_width, original_height,
        vocabulary_profile, concept_set, payload, payload_sha256
      ) values (
        '${ROOM}', '${USER}', '${GENERATION}', '${ORIGINAL_SHA}', ${WIDTH}, ${HEIGHT},
        'default', 'remove-segmentation-concepts/v1', 'x', '${"cd".repeat(32)}'
      )
    `), /row-level security/i);
    await psql(`
      revoke all on table public.vibode_bring_forward_snapshots from authenticated;
      revoke all on table public.vibode_bring_forward_selections from authenticated;
    `);
    assert.match(await psqlErrorAs("authenticated", `select * from public.vibode_bring_forward_snapshots`), /permission denied/i);

    assert.match(await psqlErrorAs("service_role", `
      insert into public.vibode_bring_forward_snapshots (
        room_id, user_id, generation_id, original_sha256, original_width, original_height,
        vocabulary_profile, concept_set, payload, payload_sha256
      ) values (
        '${ROOM}', '${USER}', '${GENERATION}', '${"AB".repeat(32)}', ${WIDTH}, ${HEIGHT},
        'default', 'remove-segmentation-concepts/v1', 'x', '${payloadSha}'
      )
    `), /vibode_bring_forward_snapshots_sha/);
    assert.match(await psqlErrorAs("service_role", `
      insert into public.vibode_bring_forward_snapshots (
        room_id, user_id, generation_id, original_sha256, original_width, original_height,
        vocabulary_profile, concept_set, payload, payload_sha256
      ) values (
        '${ROOM}', '${USER}', '${GENERATION}', '${ORIGINAL_SHA}', 0, ${HEIGHT},
        'kitchen', 'remove-segmentation-concepts/v1', 'x', '${payloadSha}'
      )
    `), /vibode_bring_forward_snapshots_profile|vibode_bring_forward_snapshots_dimensions/);
    assert.match(await psqlErrorAs("service_role", `
      insert into public.vibode_bring_forward_snapshots (
        room_id, user_id, generation_id, original_sha256, original_width, original_height,
        vocabulary_profile, concept_set, payload, payload_sha256
      ) values (
        '${ROOM}', '${USER}', '${GENERATION}', '${ORIGINAL_SHA}', ${WIDTH}, ${HEIGHT},
        'default', 'remove-segmentation-concepts/v1', '', '${payloadSha}'
      )
    `), /vibode_bring_forward_snapshots_payload_bytes/);

    const snapshotId = uuidLine(await psqlAs("service_role", `
      insert into public.vibode_bring_forward_snapshots (
        room_id, user_id, generation_id, original_sha256, original_width, original_height,
        vocabulary_profile, concept_set, payload, payload_sha256
      ) values (
        '${ROOM}', '${USER}', '${GENERATION}', '${ORIGINAL_SHA}', ${WIDTH}, ${HEIGHT},
        'default', 'remove-segmentation-concepts/v1', $bf$${canonical}$bf$, '${payloadSha}'
      )
      returning id
    `));
    assert.match(snapshotId, /^[0-9a-f-]{36}$/);
    const storedPayload = Buffer.from(await psqlAs("service_role", `
      select encode(convert_to(payload, 'UTF8'), 'base64')
      from public.vibode_bring_forward_snapshots
      where id = '${snapshotId}'
    `), "base64").toString("utf8");
    assert.equal(storedPayload, canonical);
    assert.equal(sha256(storedPayload), payloadSha);
    const accepted = acceptBringForwardSnapshot(JSON.parse(storedPayload) as unknown, {
      roomId: ROOM,
      generationId: GENERATION,
      originalSha256: ORIGINAL_SHA,
      originalWidth: WIDTH,
      originalHeight: HEIGHT,
    });
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;
    assert.deepEqual(accepted.objects.map((object) => object.id), ["lamp", "sofa"]);

    const duplicateSnapshot = await psqlErrorAs("service_role", `
      insert into public.vibode_bring_forward_snapshots (
        room_id, user_id, generation_id, original_sha256, original_width, original_height,
        vocabulary_profile, concept_set, payload, payload_sha256
      ) values (
        '${ROOM}', '${USER}', '${GENERATION}', '${ORIGINAL_SHA}', ${WIDTH}, ${HEIGHT},
        'default', 'remove-segmentation-concepts/v1', $bf$${canonical}$bf$, '${payloadSha}'
      )
    `);
    assert.match(duplicateSnapshot, /vibode_bring_forward_snapshots_identity_uidx|duplicate key/i);
    assert.equal(await psqlAs("service_role", `select count(*) from public.vibode_bring_forward_snapshots`), "1");

    assert.match(await psqlErrorAs("service_role", `
      insert into public.vibode_bring_forward_selections (
        room_id, generation_id, user_id, original_sha256, original_width, original_height,
        vocabulary_profile, snapshot_id, selected_ids, revision
      ) values (
        '${ROOM}', '${GENERATION}', '${USER}', '${ORIGINAL_SHA}', ${WIDTH}, ${HEIGHT},
        'default', '${snapshotId}', '[]'::jsonb, 0
      )
    `), /vibode_bring_forward_selections_revision/);
    assert.match(await psqlErrorAs("service_role", `
      insert into public.vibode_bring_forward_selections (
        room_id, generation_id, user_id, original_sha256, original_width, original_height,
        vocabulary_profile, snapshot_id, selected_ids, revision
      ) values (
        '${ROOM}', '${GENERATION}', '${USER}', '${ORIGINAL_SHA}', ${WIDTH}, ${HEIGHT},
        'default', '${snapshotId}', '{}'::jsonb, 1
      )
    `), /vibode_bring_forward_selections_ids/);

    const otherSnapshot = uuidLine(await psqlAs("service_role", `
      insert into public.vibode_bring_forward_snapshots (
        room_id, user_id, generation_id, original_sha256, original_width, original_height,
        vocabulary_profile, concept_set, payload, payload_sha256
      ) values (
        '${OTHER_ROOM}', '${USER}', '${GENERATION}', '${"cd".repeat(32)}', ${WIDTH}, ${HEIGHT},
        'bedroom', 'remove-segmentation-concepts/v1', 'cascade-only', '${"ef".repeat(32)}'
      )
      returning id
    `));
    const firstSave = `
      insert into public.vibode_bring_forward_selections (
        room_id, generation_id, user_id, original_sha256, original_width, original_height,
        vocabulary_profile, snapshot_id, selected_ids, revision
      ) values (
        '${OTHER_ROOM}', '${GENERATION}', '${USER}', '${"cd".repeat(32)}', ${WIDTH}, ${HEIGHT},
        'bedroom', '${otherSnapshot}', '["sofa","lamp"]'::jsonb, 1
      )
    `;
    const raced = await Promise.all([
      psqlResult("service_role", firstSave),
      psqlResult("service_role", firstSave),
    ]);
    const successes = raced.filter((result) => result.code === 0);
    const conflicts = raced.filter((result) => /duplicate key|vibode_bring_forward_selections_pkey/i.test(`${result.stderr}\n${result.stdout}`));
    assert.equal(successes.length, 1);
    assert.equal(conflicts.length, 1);
    assert.equal(await psqlAs("service_role", `
      select count(*) from public.vibode_bring_forward_selections where room_id = '${OTHER_ROOM}'
    `), "1");

    await psqlAs("service_role", `
      insert into public.vibode_bring_forward_selections (
        room_id, generation_id, user_id, original_sha256, original_width, original_height,
        vocabulary_profile, snapshot_id, selected_ids, revision
      ) values (
        '${ROOM}', '${GENERATION}', '${USER}', '${ORIGINAL_SHA}', ${WIDTH}, ${HEIGHT},
        'default', '${snapshotId}', '["sofa","lamp"]'::jsonb, 1
      )
    `);
    const holder = psqlAs("service_role", `
      begin;
      update public.vibode_bring_forward_selections
      set selected_ids = '["sofa"]'::jsonb, revision = 2, updated_at = now()
      where user_id = '${USER}' and room_id = '${ROOM}' and revision = 1;
      select pg_advisory_lock(0, 84211);
      select pg_sleep(2);
      commit;
      select pg_advisory_unlock(0, 84211);
    `);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const granted = await psql(`
        select count(*) from pg_locks
        where locktype = 'advisory' and classid = 0 and objid = 84211 and granted
      `);
      if (granted === "1") break;
      if (attempt === 39) throw new Error("revision holder did not lock the row");
      await delay(100);
    }
    const stale = await psqlAs("service_role", `
      select pg_advisory_lock(0, 84211);
      with upd as (
        update public.vibode_bring_forward_selections
        set selected_ids = '["lamp"]'::jsonb, revision = 9, updated_at = now()
        where user_id = '${USER}' and room_id = '${ROOM}' and revision = 1
        returning 1
      )
      select count(*) from upd
    `);
    await holder;
    assert.equal(lastLine(stale), "0");
    assert.equal(await psqlAs("service_role", `
      select revision::text || ':' || selected_ids::text
      from public.vibode_bring_forward_selections
      where room_id = '${ROOM}'
    `), '2:["sofa"]');

    assert.equal(await psqlAs("service_role", `
      with upd as (
        update public.vibode_bring_forward_selections
        set selected_ids = '[]'::jsonb, revision = 3, updated_at = now()
        where user_id = '${USER}' and room_id = '${ROOM}' and revision = 2
        returning jsonb_array_length(selected_ids)
      )
      select count(*)::text || ':' || coalesce(max(jsonb_array_length), -1)::text from upd
    `), "1:0");
    assert.equal(await psqlAs("service_role", `
      select count(*) from public.vibode_bring_forward_selections where room_id = '${ROOM}'
    `), "1");

    await psqlAs("service_role", `
      delete from public.vibode_bring_forward_snapshots where id = '${otherSnapshot}'
    `);
    assert.equal(await psqlAs("service_role", `
      select count(*) from public.vibode_bring_forward_selections where room_id = '${OTHER_ROOM}'
    `), "0");
    assert.equal(await psql(`select count(*) from public.vibode_rooms where id = '${OTHER_ROOM}'`), "1");

    await psql(`delete from public.vibode_rooms where id = '${ROOM}'`);
    assert.equal(await psqlAs("service_role", `
      select
        (select count(*) from public.vibode_bring_forward_snapshots where room_id = '${ROOM}')::text
        || ':' ||
        (select count(*) from public.vibode_bring_forward_selections where room_id = '${ROOM}')::text
    `), "0:0");
    assert.equal(await psql(`select count(*) from public.vibode_rooms where id = '${ROOM}'`), "0");
  } finally {
    await removeContainer();
  }
});

async function psql(sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code !== 0) throw new Error(`psql failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

async function psqlAs(user: string, sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", user, "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  if (result.code !== 0) throw new Error(`psql as ${user} failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

async function psqlResult(user: string, sql: string): Promise<Readonly<{ code: number; stdout: string; stderr: string }>> {
  return docker([
    "exec", "-i", CONTAINER, "psql", "-U", user, "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
}

async function psqlErrorAs(user: string, sql: string): Promise<string> {
  const result = await docker([
    "exec", "-i", CONTAINER, "psql", "-U", user, "-d", DATABASE, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A",
  ], sql);
  return `${result.stderr}\n${result.stdout}`;
}

async function startPostgres(): Promise<void> {
  const started = await docker([
    "run", "-d", "--name", CONTAINER,
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
    "-e", `POSTGRES_DB=${DATABASE}`,
    "postgres:16-alpine",
  ]);
  if (started.code !== 0) throw new Error(started.stderr || started.stdout);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logs = await docker(["logs", CONTAINER]);
    const text = `${logs.stdout}\n${logs.stderr}`;
    if (text.includes("PostgreSQL init process complete")) {
      const probe = await docker([
        "exec", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-t", "-A", "-c", "select 1",
      ]);
      if (probe.code === 0 && probe.stdout.trim() === "1") return;
    }
    await delay(500);
  }
  const logs = await docker(["logs", CONTAINER]);
  throw new Error(`disposable postgres 16 did not become ready\n${logs.stdout}\n${logs.stderr}`);
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

function uuidLine(value: string): string {
  const line = value.split("\n").map((item) => item.trim()).find((item) => /^[0-9a-f-]{36}$/.test(item));
  if (!line) throw new Error(`expected a uuid\n${value}`);
  return line;
}

function lastLine(value: string): string {
  const lines = value.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  return lines[lines.length - 1] ?? "";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
