import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const MIGRATION_PATH =
  "supabase/migrations/20260929180000_vibode_afc_v2_manual_perspective.sql";
const PREVIOUS_MIGRATION =
  "supabase/migrations/20260928200000_vibode_afc_v2_artifact_lineage.sql";
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
  source(PREVIOUS_MIGRATION),
  "vibode_afc_generations_protect_authority",
);
const PRODUCTION = source(PRODUCTION_MIGRATION);

test("migration adds nullable jsonb manual_perspective without a default or backfill", () => {
  assert.match(SQL, /add column if not exists manual_perspective jsonb null/);
  assert.doesNotMatch(SQL, /manual_perspective jsonb not null/);
  assert.doesNotMatch(SQL, /manual_perspective jsonb null default/);
  assert.doesNotMatch(SQL, /update public\.vibode_afc_generations/);
  assert.doesNotMatch(SQL, /insert into public\.vibode_afc_generations/);
});

test("check constraint allows null and rejects non-object json", () => {
  assert.match(SQL, /constraint vibode_afc_generations_manual_perspective_object/);
  assert.match(
    SQL,
    /manual_perspective is null\s+or jsonb_typeof\(manual_perspective\) = 'object'/,
  );
});

test("column comment keeps null distinct from a failed automatic solve", () => {
  assert.match(MIGRATION, /Null means no manual correction has been applied/);
  assert.match(MIGRATION, /failed settle/);
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
});

test("manual perspective stays writable and every previous evidence column stays frozen", () => {
  const distinct = /new\.([a-z0-9_]+) is distinct from old\.\1/g;
  const previousFields = [...PREVIOUS_TRIGGER.matchAll(distinct)].map((match) => match[1]);
  assert.ok(previousFields.includes("settle_decision"));
  assert.ok(previousFields.includes("camera_realizability_decision"));
  assert.ok(previousFields.includes("production_authority"));
  assert.ok(previousFields.includes("artifact_lineage_decision"));
  for (const field of previousFields) {
    assert.match(
      TRIGGER_BODY,
      new RegExp(`new\\.${field} is distinct from old\\.${field}`),
    );
  }
  assert.doesNotMatch(TRIGGER_BODY, /manual_perspective/);
  assert.match(TRIGGER_BODY, /if old\.status in \('ready', 'failed'\)/);
  assert.doesNotMatch(TRIGGER_BODY, /tg_op = 'DELETE'|TG_OP = 'DELETE'/);
});
