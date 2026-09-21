import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const MIGRATION_PATH =
  "supabase/migrations/20260924130000_vibode_token_charge_failures_drop_mutating_fks.sql";
const SOURCE = readFileSync(path.join(ROOT, MIGRATION_PATH), "utf8");
const LOWER = SOURCE.toLowerCase();
const WITHOUT_COMMENTS = LOWER.replace(/--[^\n]*/g, "");

const DROPPED_CONSTRAINTS = [
  "vibode_token_charge_failures_user_id_fkey",
  "vibode_token_charge_failures_room_id_fkey",
  "vibode_token_charge_failures_generation_run_id_fkey",
  "vibode_token_charge_failures_output_asset_id_fkey",
] as const;

test("FIX2 migration drops exactly the four mutating token-charge-failure FKs", () => {
  assert.match(
    WITHOUT_COMMENTS,
    /alter table public\.vibode_token_charge_failures/,
  );
  for (const name of DROPPED_CONSTRAINTS) {
    assert.match(
      WITHOUT_COMMENTS,
      new RegExp(`drop constraint if exists ${name}`),
    );
  }
  assert.equal((WITHOUT_COMMENTS.match(/drop constraint/g) ?? []).length, 4);
  assert.equal(
    (WITHOUT_COMMENTS.match(/drop constraint if exists/g) ?? []).length,
    4,
  );
});

test("FIX2 migration is idempotent and does not recreate any FK", () => {
  assert.equal(WITHOUT_COMMENTS.includes("add constraint"), false);
  assert.equal(WITHOUT_COMMENTS.includes("foreign key"), false);
  assert.equal(WITHOUT_COMMENTS.includes("on delete"), false);
  assert.equal(WITHOUT_COMMENTS.includes("on update"), false);
  assert.equal(WITHOUT_COMMENTS.includes("references auth.users"), false);
  assert.equal(WITHOUT_COMMENTS.includes("references vibode_rooms"), false);
  assert.equal(
    WITHOUT_COMMENTS.includes("references public.vibode_rooms"),
    false,
  );
  assert.equal(
    WITHOUT_COMMENTS.includes("references vibode_generation_runs"),
    false,
  );
  assert.equal(
    WITHOUT_COMMENTS.includes("references public.vibode_generation_runs"),
    false,
  );
  assert.equal(
    WITHOUT_COMMENTS.includes("references vibode_room_assets"),
    false,
  );
  assert.equal(
    WITHOUT_COMMENTS.includes("references public.vibode_room_assets"),
    false,
  );
  assert.equal(WITHOUT_COMMENTS.includes("references"), false);
});

test("FIX2 migration does not mutate rows, columns, or append-only triggers", () => {
  assert.equal(WITHOUT_COMMENTS.includes("create trigger"), false);
  assert.equal(WITHOUT_COMMENTS.includes("drop trigger"), false);
  assert.equal(WITHOUT_COMMENTS.includes("alter trigger"), false);
  assert.equal(WITHOUT_COMMENTS.includes("drop function"), false);
  assert.equal(WITHOUT_COMMENTS.includes("create or replace function"), false);
  assert.equal(
    WITHOUT_COMMENTS.includes("prevent_vibode_token_charge_failures_mutation"),
    false,
  );
  assert.equal(
    WITHOUT_COMMENTS.includes("update vibode_token_charge_failures"),
    false,
  );
  assert.equal(
    WITHOUT_COMMENTS.includes("delete from vibode_token_charge_failures"),
    false,
  );
  assert.equal(
    WITHOUT_COMMENTS.includes("insert into vibode_token_charge_failures"),
    false,
  );
  assert.equal(WITHOUT_COMMENTS.includes("delete from"), false);
  assert.equal(WITHOUT_COMMENTS.includes("update "), false);
  assert.equal(WITHOUT_COMMENTS.includes("insert "), false);
  assert.equal(WITHOUT_COMMENTS.includes("alter column"), false);
  assert.equal(WITHOUT_COMMENTS.includes("drop column"), false);
  assert.equal(WITHOUT_COMMENTS.includes("add column"), false);
  assert.equal(WITHOUT_COMMENTS.includes("set not null"), false);
  assert.equal(WITHOUT_COMMENTS.includes("drop not null"), false);
  assert.equal(WITHOUT_COMMENTS.includes("set default"), false);
  assert.equal(WITHOUT_COMMENTS.includes("drop default"), false);
  assert.equal(WITHOUT_COMMENTS.includes(" alter type "), false);
});

test("FIX2 migration refers only to the token-charge-failure ledger and the four FK names", () => {
  const identifiers = [
    ...WITHOUT_COMMENTS.matchAll(/\b[a-z_][a-z0-9_]*\b/g),
  ].map((match) => match[0]);
  const allowed = new Set([
    "alter",
    "table",
    "public",
    "vibode_token_charge_failures",
    "drop",
    "constraint",
    "if",
    "exists",
    ...DROPPED_CONSTRAINTS,
  ]);
  for (const identifier of identifiers) {
    assert.equal(
      allowed.has(identifier),
      true,
      `unexpected identifier: ${identifier}`,
    );
  }
});
