import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const MIGRATION_PATH =
  "supabase/migrations/20260928140000_vibode_afc_v2_settle_decision.sql";
const METRIC_MIGRATION =
  "supabase/migrations/20260924140000_vibode_afc_v2_metric_decision.sql";
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
  source(METRIC_MIGRATION),
  "vibode_afc_generations_protect_authority",
);
const PRODUCTION = source(PRODUCTION_MIGRATION);

test("migration adds nullable jsonb settle_decision without a default or backfill", () => {
  assert.match(SQL, /add column if not exists settle_decision jsonb null/);
  assert.doesNotMatch(SQL, /settle_decision jsonb not null/);
  assert.doesNotMatch(SQL, /settle_decision jsonb null default/);
  assert.doesNotMatch(SQL, /update public\.vibode_afc_generations/);
  assert.doesNotMatch(SQL, /insert into public\.vibode_afc_generations/);
});

test("check constraint allows null and rejects non-object json", () => {
  assert.match(SQL, /constraint vibode_afc_generations_settle_decision_object/);
  assert.match(
    SQL,
    /settle_decision is null\s+or jsonb_typeof\(settle_decision\) = 'object'/,
  );
  assert.doesNotMatch(SQL, /settle_decision->>'schemaVersion'/);
});

test("column comment keeps null distinct from not-reached, failed, and succeeded", () => {
  assert.match(MIGRATION, /Null means the decision was not captured/);
  assert.match(MIGRATION, /settle not reached, settle failed, or settle succeeded/);
  assert.match(MIGRATION, /Historical rows are intentionally null/);
});

test("migration adds no index, foreign key, table, grant, or second trigger", () => {
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

test("terminal protection freezes settle_decision and keeps every previous column", () => {
  const distinct = /new\.([a-z0-9_]+) is distinct from old\.\1/g;
  const previousFields = [...PREVIOUS_TRIGGER.matchAll(distinct)].map(
    (match) => match[1],
  );
  assert.ok(previousFields.includes("metric_decision"));
  for (const field of previousFields) {
    assert.match(
      TRIGGER_BODY,
      new RegExp(`new\\.${field} is distinct from old\\.${field}`),
    );
  }
  assert.match(
    TRIGGER_BODY,
    /new\.settle_decision is distinct from old\.settle_decision/,
  );
  assert.match(TRIGGER_BODY, /if old\.status in \('ready', 'failed'\)/);
  assert.doesNotMatch(TRIGGER_BODY, /tg_op = 'DELETE'|TG_OP = 'DELETE'/);
  const identityBlock = TRIGGER_BODY.slice(
    0,
    TRIGGER_BODY.indexOf("if old.status in ('ready', 'failed')"),
  );
  assert.doesNotMatch(identityBlock, /settle_decision/);
});
