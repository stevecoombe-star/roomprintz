import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { freezeAfcQaCapability, resolveAfcQaCapability } from "./qa-capability.server";

const ROOT = process.cwd();
const AFD1A_MIGRATION =
  "supabase/migrations/20260921120000_vibode_afc_v2_diagnostic_foundation.sql";
const AFC_PRODUCTION_MIGRATION =
  "supabase/migrations/20260908213000_vibode_afc_v2_production_generations.sql";
const AFD1B_MIGRATION =
  "supabase/migrations/20260922120000_vibode_afc_v2_engine_fingerprint.sql";

function source(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function withoutComments(sql: string) {
  return sql.replace(/--[^\n]*/g, "");
}

function tableBody(sql: string, table: string) {
  const match = sql.match(
    new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\);`),
  );
  assert.ok(match, `expected create table public.${table}`);
  return match[1];
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

const DIAGNOSTIC_MIGRATION = source(AFD1A_MIGRATION);
const PRODUCTION_MIGRATION = source(AFC_PRODUCTION_MIGRATION);
const FINGERPRINT_MIGRATION = source(AFD1B_MIGRATION);
const DELETE_USER = source("app/api/admin/delete-user/route.ts");
const AFC_CLEANUP = source(
  "lib/afc-v2-production/delete-user-afc-storage.server.ts",
);
const ADMIN_CONTROLS = source("app/admin/AdminControls.tsx");
const CAPABILITY = source("lib/afc-v2-diagnostics/qa-capability.server.ts");
const CAPABILITY_ROUTE = source("app/api/vibode/afc/qa/capability/route.ts");

test("23) AFD-1A Session user/room FKs cascade (static schema)", () => {
  const body = tableBody(DIAGNOSTIC_MIGRATION, "vibode_afc_diagnostic_sessions");
  assert.match(
    body,
    /room_id uuid not null references public\.vibode_rooms\(id\) on delete cascade/,
  );
  assert.match(
    body,
    /user_id uuid not null references auth\.users\(id\) on delete cascade/,
  );
});

test("24) Session ↔ Generation membership cleanup cascades (static schema)", () => {
  const body = tableBody(
    DIAGNOSTIC_MIGRATION,
    "vibode_afc_diagnostic_session_generations",
  );
  assert.match(
    body,
    /session_id uuid not null\s+references public\.vibode_afc_diagnostic_sessions\(id\) on delete cascade/,
  );
  assert.match(
    body,
    /generation_id uuid not null\s+references public\.vibode_afc_generations\(id\) on delete cascade/,
  );
});

test("25) Case reporter/session/room deletion semantics (static schema)", () => {
  const body = tableBody(DIAGNOSTIC_MIGRATION, "vibode_afc_diagnostic_cases");
  assert.match(
    body,
    /session_id uuid not null\s+references public\.vibode_afc_diagnostic_sessions\(id\) on delete cascade/,
  );
  assert.match(
    body,
    /room_id uuid not null\s+references public\.vibode_rooms\(id\) on delete cascade/,
  );
  assert.match(
    body,
    /reporter_user_id uuid not null\s+references auth\.users\(id\) on delete cascade/,
  );
  assert.match(
    body,
    /reported_generation_id uuid not null\s+references public\.vibode_afc_generations\(id\) on delete cascade/,
  );
});

test("26) reviewer ON DELETE SET NULL (static schema)", () => {
  const body = tableBody(DIAGNOSTIC_MIGRATION, "vibode_afc_diagnostic_cases");
  assert.match(
    body,
    /reviewer_user_id uuid null\s+references auth\.users\(id\) on delete set null/,
  );
});

test("27) AFC generation user/room cascade behavior (static schema)", () => {
  const body = tableBody(PRODUCTION_MIGRATION, "vibode_afc_generations");
  assert.match(
    body,
    /room_id uuid not null references public\.vibode_rooms\(id\) on delete cascade/,
  );
  assert.match(
    body,
    /user_id uuid not null references auth\.users\(id\) on delete cascade/,
  );
  assert.match(
    PRODUCTION_MIGRATION,
    /current_afc_generation_id[\s\S]*on delete set null/,
  );
});

test("28) terminal immutability trigger remains UPDATE-only (static schema)", () => {
  assert.match(
    PRODUCTION_MIGRATION,
    /create trigger vibode_afc_generations_protect_authority\s+before update on public\.vibode_afc_generations/,
  );
  assert.doesNotMatch(
    PRODUCTION_MIGRATION,
    /before update or delete on public\.vibode_afc_generations/,
  );
  const trigger = functionBody(
    FINGERPRINT_MIGRATION,
    "vibode_afc_generations_protect_authority",
  );
  assert.doesNotMatch(trigger, /tg_op = 'DELETE'|TG_OP = 'DELETE'/);
  assert.match(trigger, /if old\.status in \('ready', 'failed'\)/);
});

test("29) DELETE/cascade is not blocked by the AFD-1B trigger (static schema)", () => {
  assert.doesNotMatch(
    FINGERPRINT_MIGRATION,
    /before delete on public\.vibode_afc_generations/,
  );
  assert.match(
    FINGERPRINT_MIGRATION,
    /DELETE is intentionally not protected so room\/user cascade still works/,
  );
});

test("30) existing delete-user browser response shape remains unchanged", () => {
  assert.match(DELETE_USER, /success: true/);
  assert.match(DELETE_USER, /deletedStorageFiles/);
  assert.match(DELETE_USER, /skippedStorageFiles/);
  assert.match(DELETE_USER, /deletedRowsByTable/);
  assert.match(DELETE_USER, /authUserDeleted: true/);
  assert.doesNotMatch(DELETE_USER, /afcObjectPaths|deletedAfcPaths|storageReceipts/);
  assert.match(
    ADMIN_CONTROLS,
    /body: JSON\.stringify\(\{\s+userId,\s+confirmEmail: deleteConfirmEmailInput,\s+\}\)/,
  );
});

test("31) AFC object paths are not returned", () => {
  assert.match(DELETE_USER, /Failed deleting AFC storage\./);
  assert.doesNotMatch(
    DELETE_USER,
    /Failed deleting AFC storage[\s\S]{0,200}users\//,
  );
  assert.doesNotMatch(DELETE_USER, /afcCleanup\.keys|collected\.keys/);
  assert.doesNotMatch(AFC_CLEANUP, /NextResponse|console\.(log|info|warn|error|debug)/);
});

test("32) storage deletion result details are not returned", () => {
  const failure = DELETE_USER.slice(
    DELETE_USER.indexOf("if (!afcCleanup.ok)"),
    DELETE_USER.indexOf("const deletedRowsByTable"),
  );
  assert.match(failure, /error: "Failed deleting AFC storage\."/);
  assert.doesNotMatch(failure, /afcCleanup\.keys|removedPaths|objectPaths/);
  assert.doesNotMatch(DELETE_USER, /deletedAfcStorageFiles|afcCleanup\.keys/);
});

test("33) QA capability endpoint remains { enabled } only", () => {
  assert.deepEqual(freezeAfcQaCapability({ enabled: true }), { enabled: true });
  assert.deepEqual(
    resolveAfcQaCapability("22222222-2222-4222-8222-222222222222", {}),
    { enabled: false },
  );
  assert.match(CAPABILITY_ROUTE, /export async function GET/);
  assert.doesNotMatch(CAPABILITY_ROUTE, /export async function POST/);
  assert.doesNotMatch(CAPABILITY, /deleteAfcV2UserStorage|delete-user-afc-storage/);
});

test("34) analyze/restore/runtime remain unchanged by AFD-1D", () => {
  for (const relative of [
    "app/api/vibode/afc/analyze/route.ts",
    "app/api/vibode/afc/restore/route.ts",
    "app/api/vibode/afc/runtime/route.ts",
    "lib/afc-v2-production/production-adapter.server.ts",
    "lib/afc-v2-production/engine-fingerprint.ts",
    "lib/afc-v2-production/production-persistence.server.ts",
  ]) {
    const text = source(relative);
    assert.doesNotMatch(text, /deleteAfcV2UserStorage|delete-user-afc-storage/);
    assert.doesNotMatch(text, /createAdminDeleteUserPostHandler/);
  }
});

test("35) no new public storage permissions", () => {
  assert.match(
    PRODUCTION_MIGRATION,
    /create policy vibode_afc_v2_deny_authenticated/,
  );
  assert.match(PRODUCTION_MIGRATION, /bucket_id <> 'vibode-afc-v2'/);
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations"));
  assert.equal(
    migrations.some((name) => /afd-1d|afc_v2_deletion|afc_v2_cleanup/i.test(name)),
    false,
  );
});

test("36) no new browser storage calls", () => {
  assert.doesNotMatch(ADMIN_CONTROLS, /vibode-afc-v2|deleteAfcV2UserStorage/);
  assert.doesNotMatch(
    source("app/editor/page.tsx"),
    /vibode-afc-v2|deleteAfcV2UserStorage/,
  );
  assert.doesNotMatch(
    AFC_CLEANUP,
    /createBrowserClient|getCookieSupabaseClient/,
  );
});

test("AFD-1D binds cleanup to vibode-afc-v2 and the existing user prefix", () => {
  assert.match(AFC_CLEANUP, /AFC_V2_PRODUCTION_STORAGE_BUCKET/);
  assert.match(AFC_CLEANUP, /afcGenerationStoragePrefix/);
  assert.match(AFC_CLEANUP, /isOwnedOriginalStoragePath/);
  assert.match(AFC_CLEANUP, /afcV2UserExclusiveStoragePrefix/);
  assert.match(AFC_CLEANUP, /\.list\(/);
  assert.match(AFC_CLEANUP, /users\/\$\{userId\}/);
  assert.doesNotMatch(AFC_CLEANUP, /payload\.bucket|request\.json/);
  assert.doesNotMatch(DELETE_USER, /payload\.bucket|payload\.objectPaths/);
  assert.match(
    source("lib/afc-v2-production/production-adapter.server.ts"),
    /admin\/receipts\/generation\.json/,
  );
  assert.match(AFC_CLEANUP, /admin\/receipts\/generation\.json/);
});

test("delete-user authorization remains admin + confirm email", () => {
  assert.match(DELETE_USER, /getAuthenticatedAdminUser/);
  assert.match(DELETE_USER, /You cannot delete your own admin user/);
  assert.match(
    DELETE_USER,
    /Confirmation email does not match target user email/,
  );
  assert.match(DELETE_USER, /type DeleteUserPayload = \{\s+userId\?: unknown;\s+confirmEmail\?: unknown;\s+\}/);
  assert.doesNotMatch(DELETE_USER, /payload\.bucket|payload\.objectPaths|payload\.paths/);
  assert.doesNotMatch(DELETE_USER, /export async function GET/);
});

test("AFC cleanup runs before DB/auth deletion in the orchestrator", () => {
  const cleanupAt = DELETE_USER.indexOf("cleanupAfcV2Storage");
  const roomsDeleteAt = DELETE_USER.indexOf('"vibode_rooms"');
  const authDeleteAt = DELETE_USER.indexOf("auth.admin.deleteUser");
  const otherRemoveAt = DELETE_USER.indexOf(
    "supabaseAdmin.storage.from(candidate.bucket).remove",
  );
  assert.ok(cleanupAt > 0);
  assert.ok(cleanupAt < roomsDeleteAt);
  assert.ok(cleanupAt < otherRemoveAt);
  assert.ok(cleanupAt < authDeleteAt);
  assert.match(DELETE_USER, /getServiceRoleSupabaseClient/);
  assert.match(DELETE_USER, /deleteAfcV2UserStorage/);
});

test("durable AFC artifact rows cascade from auth.users (static schema)", () => {
  const empty = tableBody(
    PRODUCTION_MIGRATION,
    "vibode_afc_durable_empty_artifacts",
  );
  const tiled = tableBody(
    PRODUCTION_MIGRATION,
    "vibode_afc_durable_tiled_artifacts",
  );
  assert.match(
    empty,
    /user_id uuid not null references auth\.users\(id\) on delete cascade/,
  );
  assert.match(
    tiled,
    /user_id uuid not null references auth\.users\(id\) on delete cascade/,
  );
});

test("QA capability contract is unchanged and stays off by default", () => {
  assert.match(CAPABILITY, /not\s+launch-ready/);
  assert.match(CAPABILITY, /explicit later operational decision/);
  assert.doesNotMatch(CAPABILITY, /VIBODE_AFC_QA_MODE\s*=\s*"allowlist"|mode === "allowlist" && true/);
  assert.equal(
    resolveAfcQaCapability("22222222-2222-4222-8222-222222222222", {
      VIBODE_AFC_QA_MODE: "off",
    }).enabled,
    false,
  );
});

test("Editor and Partner Portal stay out of AFD-1D", () => {
  assert.doesNotMatch(
    source("app/editor/page.tsx"),
    /delete-user-afc-storage|Failed deleting AFC storage/,
  );
  const partner = source("lib/vibode-stage/pi5g1-partner-portal.test.ts");
  assert.doesNotMatch(partner, /deleteAfcV2UserStorage/);
  assert.doesNotMatch(
    withoutComments(DIAGNOSTIC_MIGRATION),
    /storage_path|vibode-afc-v2/,
  );
});
