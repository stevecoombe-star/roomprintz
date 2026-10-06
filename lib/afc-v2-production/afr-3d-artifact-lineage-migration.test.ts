import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const MIGRATION_PATH =
  "supabase/migrations/20260928200000_vibode_afc_v2_artifact_lineage.sql";
const CAMERA_MIGRATION =
  "supabase/migrations/20260928180000_vibode_afc_v2_camera_realizability.sql";
const PRODUCTION_MIGRATION =
  "supabase/migrations/20260908213000_vibode_afc_v2_production_generations.sql";

function source(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function withoutComments(sql: string) {
  return sql.replace(/--[^\n]*/g, "");
}

function functionBody(sql: string, name: string) {
  const match = sql.match(
    new RegExp(
      `create or replace function public\\.${name}\\(\\)[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$`,
    ),
  );
  assert.ok(match, `expected function public.${name}`);
  return match[1];
}

const MIGRATION = source(MIGRATION_PATH);
const SQL = withoutComments(MIGRATION);
const TRIGGER_BODY = functionBody(
  MIGRATION,
  "vibode_afc_generations_protect_authority",
);
const PREVIOUS_TRIGGER = functionBody(
  source(CAMERA_MIGRATION),
  "vibode_afc_generations_protect_authority",
);
const PRODUCTION = source(PRODUCTION_MIGRATION);

test("migration adds nullable jsonb artifact_lineage_decision without a default or backfill", () => {
  assert.match(SQL, /add column if not exists artifact_lineage_decision jsonb null/);
  assert.doesNotMatch(SQL, /artifact_lineage_decision jsonb not null/);
  assert.doesNotMatch(SQL, /artifact_lineage_decision jsonb null default/);
  assert.doesNotMatch(SQL, /update public\.vibode_afc_generations/);
  assert.doesNotMatch(SQL, /insert into public\.vibode_afc_generations/);
});

test("check constraint allows null and rejects non-object json", () => {
  assert.match(SQL, /constraint vibode_afc_generations_artifact_lineage_decision_object/);
  assert.match(
    SQL,
    /artifact_lineage_decision is null\s+or jsonb_typeof\(artifact_lineage_decision\) = 'object'/,
  );
  assert.doesNotMatch(SQL, /artifact_lineage_decision->>'schemaVersion'/);
});

test("column comment keeps null distinct from an unknown source or a reader failure", () => {
  assert.match(MIGRATION, /Null means the diagnostic was not captured/);
  assert.match(MIGRATION, /unknown artifact source/);
  assert.match(MIGRATION, /Historical rows are intentionally null/);
});

test("migration adds no index, foreign key, table, grant, trigger, or RLS change", () => {
  assert.doesNotMatch(SQL, /create index|using gin/i);
  assert.doesNotMatch(SQL, /references /);
  assert.doesNotMatch(SQL, /create table/);
  assert.doesNotMatch(SQL, /create trigger/);
  assert.doesNotMatch(SQL, /\bgrant\b/i);
  assert.doesNotMatch(SQL, /\brevoke\b/i);
  assert.doesNotMatch(SQL, /create policy/i);
  assert.doesNotMatch(SQL, /row level security/i);
  assert.match(PRODUCTION, /alter table public\.vibode_afc_generations enable row level security/);
  assert.match(
    PRODUCTION,
    /revoke all on table public\.vibode_afc_generations from public, anon, authenticated/,
  );
  assert.match(
    PRODUCTION,
    /grant select, insert, update, delete on table public\.vibode_afc_generations\s+to service_role/,
  );
});

test("terminal protection freezes artifact_lineage_decision and keeps every previous column", () => {
  const distinct = /new\.([a-z0-9_]+) is distinct from old\.\1/g;
  const previousFields = [...PREVIOUS_TRIGGER.matchAll(distinct)].map(
    (match) => match[1],
  );
  assert.ok(previousFields.includes("camera_realizability_decision"));
  assert.ok(previousFields.includes("settle_decision"));
  assert.ok(previousFields.includes("metric_decision"));
  for (const field of previousFields) {
    assert.match(
      TRIGGER_BODY,
      new RegExp(`new\\.${field} is distinct from old\\.${field}`),
    );
  }
  assert.match(
    TRIGGER_BODY,
    /new\.artifact_lineage_decision is distinct from old\.artifact_lineage_decision/,
  );
  assert.match(TRIGGER_BODY, /if old\.status in \('ready', 'failed'\)/);
  assert.doesNotMatch(TRIGGER_BODY, /tg_op = 'DELETE'|TG_OP = 'DELETE'/);
  const identityBlock = TRIGGER_BODY.slice(
    0,
    TRIGGER_BODY.indexOf("if old.status in ('ready', 'failed')"),
  );
  assert.doesNotMatch(identityBlock, /artifact_lineage_decision/);
});
