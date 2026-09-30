import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const MIGRATION_PATH =
  "supabase/migrations/20260930120000_vibode_afc_v2_manual_perspective_recovery.sql";
const PREVIOUS_MIGRATION =
  "supabase/migrations/20260929180000_vibode_afc_v2_manual_perspective.sql";
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

test("recovery migration adds nullable jsonb provenance and does not edit intent", () => {
  assert.match(SQL, /add column if not exists recovery_provenance jsonb null/);
  assert.doesNotMatch(SQL, /recovery_provenance jsonb not null/);
  assert.doesNotMatch(SQL, /recovery_provenance jsonb null default/);
  assert.doesNotMatch(SQL, /update public\.vibode_afc_generations/);
  assert.doesNotMatch(SQL, /manual_perspective_recovery/);
  assert.doesNotMatch(SQL, /intent in \(/);
  assert.match(PRODUCTION, /intent in \('analyze', 'run_again', 'reread_perspective'\)/);
});

test("recovery provenance accepts null or an object and adds no grant or RLS change", () => {
  assert.match(SQL, /constraint vibode_afc_generations_recovery_provenance_object/);
  assert.match(
    SQL,
    /recovery_provenance is null\s+or jsonb_typeof\(recovery_provenance\) = 'object'/,
  );
  assert.doesNotMatch(SQL, /create index|using gin/i);
  assert.doesNotMatch(SQL, /references /);
  assert.doesNotMatch(SQL, /create table/);
  assert.doesNotMatch(SQL, /create trigger/);
  assert.doesNotMatch(SQL, /\bgrant\b/i);
  assert.doesNotMatch(SQL, /\brevoke\b/i);
  assert.doesNotMatch(SQL, /create policy/i);
  assert.match(PRODUCTION, /alter table public\.vibode_afc_generations enable row level security/);
});

test("recovery provenance freezes with terminal evidence and manual perspective stays writable", () => {
  const distinct = /new\.([a-z0-9_]+) is distinct from old\.\1/g;
  const previousFields = [...PREVIOUS_TRIGGER.matchAll(distinct)].map((match) => match[1]);
  for (const field of previousFields) {
    assert.match(
      TRIGGER_BODY,
      new RegExp(`new\\.${field} is distinct from old\\.${field}`),
    );
  }
  assert.match(TRIGGER_BODY, /new\.recovery_provenance is distinct from old\.recovery_provenance/);
  assert.doesNotMatch(TRIGGER_BODY, /manual_perspective/);
  assert.match(MIGRATION, /Historical rows are intentionally null/);
  assert.match(MIGRATION, /not production authority/i);
});
