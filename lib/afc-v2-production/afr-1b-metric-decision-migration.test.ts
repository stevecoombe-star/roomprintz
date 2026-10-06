import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const MIGRATION_PATH =
  "supabase/migrations/20260924140000_vibode_afc_v2_metric_decision.sql";
const FINGERPRINT_MIGRATION =
  "supabase/migrations/20260922120000_vibode_afc_v2_engine_fingerprint.sql";
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
  source(FINGERPRINT_MIGRATION),
  "vibode_afc_generations_protect_authority",
);
const PRODUCTION = source(PRODUCTION_MIGRATION);

test("migration adds nullable jsonb metric_decision without a default or backfill", () => {
  assert.match(
    SQL,
    /add column if not exists metric_decision jsonb null/,
  );
  assert.doesNotMatch(SQL, /metric_decision jsonb not null/);
  assert.doesNotMatch(SQL, /metric_decision jsonb null default/);
  assert.doesNotMatch(SQL, /update public\.vibode_afc_generations/);
  assert.doesNotMatch(SQL, /insert into public\.vibode_afc_generations/);
});

test("check constraint allows null and rejects non-object json", () => {
  assert.match(
    SQL,
    /constraint vibode_afc_generations_metric_decision_object/,
  );
  assert.match(
    SQL,
    /metric_decision is null\s+or jsonb_typeof\(metric_decision\) = 'object'/,
  );
  assert.doesNotMatch(SQL, /jsonb_typeof\(metric_decision\) = 'array'/);
  assert.doesNotMatch(SQL, /metric_decision->>'schemaVersion'/);
  assert.doesNotMatch(SQL, /metric_decision \? /);
});

test("column comment records not-captured null and forbids historical reconstruction", () => {
  assert.match(
    MIGRATION,
    /Generation-scoped AFC metric-decision diagnostic evidence/,
  );
  assert.match(MIGRATION, /Null means the decision was not captured/);
  assert.match(
    MIGRATION,
    /Null must not be interpreted as Gemini returning no estimate/,
  );
  assert.match(MIGRATION, /Historical rows are intentionally null/);
});

test("migration adds no index, foreign key, table, or second trigger", () => {
  assert.doesNotMatch(SQL, /create index|using gin/i);
  assert.doesNotMatch(SQL, /references /);
  assert.doesNotMatch(SQL, /create table/);
  assert.doesNotMatch(SQL, /create trigger/);
  assert.doesNotMatch(SQL, /before delete/);
  assert.match(
    MIGRATION,
    /The existing BEFORE UPDATE trigger already calls this function/,
  );
});

test("terminal protection freezes metric_decision and keeps every previous column", () => {
  const distinct = /new\.([a-z0-9_]+) is distinct from old\.\1/g;
  const previousFields = [...PREVIOUS_TRIGGER.matchAll(distinct)].map(
    (match) => match[1],
  );
  assert.ok(previousFields.length > 20);
  for (const field of previousFields) {
    assert.match(
      TRIGGER_BODY,
      new RegExp(`new\\.${field} is distinct from old\\.${field}`),
    );
  }
  assert.match(
    TRIGGER_BODY,
    /new\.metric_decision is distinct from old\.metric_decision/,
  );
  assert.match(TRIGGER_BODY, /if old\.status in \('ready', 'failed'\)/);
  assert.doesNotMatch(TRIGGER_BODY, /if new\.status in \('ready', 'failed'\)/);
  assert.doesNotMatch(TRIGGER_BODY, /old\.status = 'running'/);
  assert.match(
    TRIGGER_BODY,
    /raise exception 'AFC generation historical evidence is immutable once terminal'/,
  );
  const terminalBlock = TRIGGER_BODY.slice(
    TRIGGER_BODY.indexOf("if old.status in ('ready', 'failed')"),
  );
  assert.match(terminalBlock, /metric_decision/);
  const identityBlock = TRIGGER_BODY.slice(
    0,
    TRIGGER_BODY.indexOf("if old.status in ('ready', 'failed')"),
  );
  assert.doesNotMatch(identityBlock, /metric_decision/);
});

test("delete and cascade behavior stay unchanged", () => {
  assert.match(
    PRODUCTION,
    /room_id uuid not null references public\.vibode_rooms\(id\) on delete cascade/,
  );
  assert.match(
    PRODUCTION,
    /user_id uuid not null references auth\.users\(id\) on delete cascade/,
  );
  assert.match(
    PRODUCTION,
    /create trigger vibode_afc_generations_protect_authority\s+before update on public\.vibode_afc_generations/,
  );
  assert.doesNotMatch(PRODUCTION, /before update or delete/);
  assert.doesNotMatch(TRIGGER_BODY, /tg_op = 'DELETE'|TG_OP = 'DELETE'/);
  assert.match(
    MIGRATION,
    /DELETE is not protected, so room and user cascade still work/,
  );
});

test("no new anon, authenticated, or public grants and RLS is untouched", () => {
  assert.doesNotMatch(SQL, /\bgrant\b/i);
  assert.doesNotMatch(SQL, /\brevoke\b/i);
  assert.doesNotMatch(SQL, /create policy/i);
  assert.doesNotMatch(SQL, /row level security/i);
  assert.match(
    PRODUCTION,
    /alter table public\.vibode_afc_generations enable row level security/,
  );
  assert.match(
    PRODUCTION,
    /revoke all on table public\.vibode_afc_generations from public, anon, authenticated/,
  );
  assert.match(
    PRODUCTION,
    /grant select, insert, update, delete on table public\.vibode_afc_generations\s+to service_role/,
  );
});

test("metric_decision stays out of public analyze and unchanged metric policy modules", () => {
  const untouched = [
    "lib/afc-v2-production/production-auto-metric.ts",
    "lib/afc-v2-production/production-authority-contract.ts",
    "app/api/vibode/afc/analyze/route.ts",
    "app/admin/3d-room-lab-v2/metric-auto-scale.ts",
    "app/admin/3d-room-lab-v2/observed-span-auto-metric-scale.ts",
    "app/admin/3d-room-lab-v2/afc-v2-analysis.server.ts",
    "app/admin/3d-room-lab-v2/scene-metric-world-realization.ts",
  ];
  for (const relativePath of untouched) {
    assert.doesNotMatch(
      source(relativePath),
      /metric_decision|metricDecision|AfcV2MetricDecision/,
      relativePath,
    );
  }
});
