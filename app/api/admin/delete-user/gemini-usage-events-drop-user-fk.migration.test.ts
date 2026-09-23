import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const MIGRATION_PATH =
  "supabase/migrations/20260924120000_vibode_gemini_usage_events_drop_user_fk.sql";
const SOURCE = readFileSync(path.join(ROOT, MIGRATION_PATH), "utf8");
const LOWER = SOURCE.toLowerCase();
const WITHOUT_COMMENTS = LOWER.replace(/--[^\n]*/g, "");

test("FIX1 migration drops only vibode_gemini_usage_events_user_id_fkey", () => {
  assert.match(
    WITHOUT_COMMENTS,
    /alter table public\.vibode_gemini_usage_events/,
  );
  assert.match(
    WITHOUT_COMMENTS,
    /drop constraint if exists vibode_gemini_usage_events_user_id_fkey/,
  );
  assert.equal(
    (WITHOUT_COMMENTS.match(/drop constraint/g) ?? []).length,
    1,
  );
  assert.equal(
    WITHOUT_COMMENTS.includes("vibode_gemini_usage_events_room_id_fkey"),
    false,
  );
  assert.equal(
    WITHOUT_COMMENTS.includes("vibode_gemini_usage_events_asset_id_fkey"),
    false,
  );
  assert.equal(
    WITHOUT_COMMENTS.includes("vibode_gemini_usage_events_version_id_fkey"),
    false,
  );
});

test("FIX1 migration is idempotent and does not recreate an FK", () => {
  assert.match(WITHOUT_COMMENTS, /drop constraint if exists/);
  assert.equal(WITHOUT_COMMENTS.includes("add constraint"), false);
  assert.equal(WITHOUT_COMMENTS.includes("references"), false);
  assert.equal(WITHOUT_COMMENTS.includes("foreign key"), false);
  assert.equal(WITHOUT_COMMENTS.includes("on delete"), false);
  assert.equal(WITHOUT_COMMENTS.includes("on update"), false);
});

test("FIX1 migration does not mutate rows or append-only triggers", () => {
  assert.equal(WITHOUT_COMMENTS.includes("drop trigger"), false);
  assert.equal(WITHOUT_COMMENTS.includes("create trigger"), false);
  assert.equal(WITHOUT_COMMENTS.includes("create or replace function"), false);
  assert.equal(WITHOUT_COMMENTS.includes("prevent_vibode_gemini_usage_events_mutation"), false);
  assert.equal(WITHOUT_COMMENTS.includes("delete from"), false);
  assert.equal(WITHOUT_COMMENTS.includes("update "), false);
  assert.equal(WITHOUT_COMMENTS.includes("insert "), false);
  assert.equal(WITHOUT_COMMENTS.includes("alter column"), false);
  assert.equal(WITHOUT_COMMENTS.includes("drop column"), false);
});
