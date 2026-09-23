import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  assertProductionPayloadPrivacy,
  collectProductionPayloadPrivacyViolations,
} from "@/lib/afc-v2-production/privacy";
import {
  productionAfcJson,
  type ProductionAfcAuth,
} from "@/lib/afc-v2-production/production-http";

import {
  freezeAfcQaCapability,
  handleAfcQaCapabilityGet,
  parseAfcQaMode,
  parseAfcQaUserIds,
  resolveAfcQaCapability,
  resolveAfcQaCapabilityForUser,
  type AfcQaCapabilityEnv,
} from "./qa-capability.server";

const ROOT = process.cwd();
const ALLOWLISTED_USER = "22222222-2222-4222-8222-222222222222";
const OTHER_USER = "33333333-3333-4333-8333-333333333333";
const THIRD_USER = "44444444-4444-4444-8444-444444444444";
const ADMIN_SHAPED_USER = "55555555-5555-4555-8555-555555555555";

function source(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function unauthorized(): ProductionAfcAuth {
  return {
    ok: false,
    response: productionAfcJson({ error: "Unauthorized." }, 401),
  };
}

function authorized(userId: string): ProductionAfcAuth {
  return { ok: true, userId };
}

async function getCapability(args: {
  userId?: string | null;
  url?: string;
  env?: AfcQaCapabilityEnv;
}) {
  return handleAfcQaCapabilityGet({
    request: new Request(
      args.url ?? "http://test/api/vibode/afc/qa/capability",
    ),
    authorize: async () =>
      args.userId ? authorized(args.userId) : unauthorized(),
    env: args.env,
  });
}

async function jsonBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test("1) missing mode → off", () => {
  assert.equal(parseAfcQaMode(undefined), "off");
});

test("2) empty mode → off", () => {
  assert.equal(parseAfcQaMode(""), "off");
  assert.equal(parseAfcQaMode("   "), "off");
});

test("3) off → off", () => {
  assert.equal(parseAfcQaMode("off"), "off");
});

test("4) allowlist → allowlist", () => {
  assert.equal(parseAfcQaMode("allowlist"), "allowlist");
});

test("5) all → all", () => {
  assert.equal(parseAfcQaMode("all"), "all");
});

test("6) invalid value → off", () => {
  for (const value of ["enabled", "true", "beta", "foobar", "OFF", "All", "Allowlist"]) {
    assert.equal(parseAfcQaMode(value), "off", value);
  }
});

test("7) whitespace trimmed correctly", () => {
  assert.equal(parseAfcQaMode("  all  "), "all");
  assert.equal(parseAfcQaMode("\tallowlist\n"), "allowlist");
  assert.equal(parseAfcQaMode(" off "), "off");
});

test("8) valid UUID accepted", () => {
  const ids = parseAfcQaUserIds(ALLOWLISTED_USER);
  assert.equal(ids.size, 1);
  assert.equal(ids.has(ALLOWLISTED_USER), true);
});

test("9) multiple UUIDs accepted", () => {
  const ids = parseAfcQaUserIds(`${ALLOWLISTED_USER},${OTHER_USER}`);
  assert.equal(ids.size, 2);
  assert.equal(ids.has(ALLOWLISTED_USER), true);
  assert.equal(ids.has(OTHER_USER), true);
});

test("10) whitespace trimmed", () => {
  const ids = parseAfcQaUserIds(` ${ALLOWLISTED_USER} , ${OTHER_USER} `);
  assert.equal(ids.size, 2);
  assert.equal(ids.has(ALLOWLISTED_USER), true);
  assert.equal(ids.has(OTHER_USER), true);
});

test("11) duplicates de-duplicated", () => {
  const ids = parseAfcQaUserIds(
    `${ALLOWLISTED_USER},${ALLOWLISTED_USER.toUpperCase()},${ALLOWLISTED_USER}`,
  );
  assert.equal(ids.size, 1);
  assert.equal(ids.has(ALLOWLISTED_USER), true);
});

test("12) empty tokens ignored", () => {
  const ids = parseAfcQaUserIds(`,${ALLOWLISTED_USER},, ,${OTHER_USER},`);
  assert.equal(ids.size, 2);
});

test("13) invalid UUID ignored", () => {
  const ids = parseAfcQaUserIds(
    `not-a-uuid,admin@example.com,11111111-1111-4111-7111-111111111111,${ALLOWLISTED_USER}`,
  );
  assert.equal(ids.size, 1);
  assert.equal(ids.has(ALLOWLISTED_USER), true);
});

test("14) missing env → empty set", () => {
  assert.equal(parseAfcQaUserIds(undefined).size, 0);
  assert.equal(parseAfcQaUserIds("").size, 0);
  assert.equal(parseAfcQaUserIds("   ").size, 0);
});

test("15) off disables allowlisted user", () => {
  assert.deepEqual(
    resolveAfcQaCapabilityForUser({
      userId: ALLOWLISTED_USER,
      mode: "off",
      allowlist: new Set([ALLOWLISTED_USER]),
    }),
    { enabled: false },
  );
});

test("16) off disables arbitrary user", () => {
  assert.deepEqual(
    resolveAfcQaCapabilityForUser({
      userId: OTHER_USER,
      mode: "off",
      allowlist: new Set([ALLOWLISTED_USER]),
    }),
    { enabled: false },
  );
});

test("17) all enables authenticated user", () => {
  assert.deepEqual(
    resolveAfcQaCapabilityForUser({
      userId: OTHER_USER,
      mode: "all",
      allowlist: new Set(),
    }),
    { enabled: true },
  );
});

test("18) allowlist enables matching user", () => {
  assert.deepEqual(
    resolveAfcQaCapabilityForUser({
      userId: ALLOWLISTED_USER.toUpperCase(),
      mode: "allowlist",
      allowlist: parseAfcQaUserIds(ALLOWLISTED_USER),
    }),
    { enabled: true },
  );
});

test("19) allowlist disables non-matching user", () => {
  assert.deepEqual(
    resolveAfcQaCapabilityForUser({
      userId: OTHER_USER,
      mode: "allowlist",
      allowlist: parseAfcQaUserIds(ALLOWLISTED_USER),
    }),
    { enabled: false },
  );
});

test("20) allowlist with empty list disables everyone", () => {
  assert.deepEqual(
    resolveAfcQaCapabilityForUser({
      userId: ALLOWLISTED_USER,
      mode: "allowlist",
      allowlist: parseAfcQaUserIds(undefined),
    }),
    { enabled: false },
  );
  assert.deepEqual(
    resolveAfcQaCapability(ALLOWLISTED_USER, {
      VIBODE_AFC_QA_MODE: "allowlist",
    }),
    { enabled: false },
  );
});

test("21) invalid mode disables everyone", () => {
  assert.deepEqual(
    resolveAfcQaCapability(ALLOWLISTED_USER, {
      VIBODE_AFC_QA_MODE: "enabled",
      VIBODE_AFC_QA_USER_IDS: ALLOWLISTED_USER,
    }),
    { enabled: false },
  );
});

test("22) admin identity receives no special treatment", () => {
  const capability = source("lib/afc-v2-diagnostics/qa-capability.server.ts");
  const route = source("app/api/vibode/afc/qa/capability/route.ts");
  assert.doesNotMatch(capability, /VIBODE_ADMIN_EMAIL|isAdminEmail|getAuthenticatedAdminUser/);
  assert.doesNotMatch(route, /VIBODE_ADMIN_EMAIL|isAdminEmail|getAuthenticatedAdminUser/);
  assert.deepEqual(
    resolveAfcQaCapability(ADMIN_SHAPED_USER, {
      VIBODE_AFC_QA_MODE: "allowlist",
      VIBODE_AFC_QA_USER_IDS: ALLOWLISTED_USER,
    }),
    { enabled: false },
  );
});

test("23) partner membership is not consulted", () => {
  const capability = source("lib/afc-v2-diagnostics/qa-capability.server.ts");
  const route = source("app/api/vibode/afc/qa/capability/route.ts");
  assert.doesNotMatch(
    `${capability}\n${route}`,
    /partner|betaSettings|VIBODE_BETA/,
  );
});

test("24) unauthenticated request rejected using existing auth semantics", async () => {
  const response = await getCapability({
    env: { VIBODE_AFC_QA_MODE: "all" },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await jsonBody(response), { error: "Unauthorized." });
  const route = source("app/api/vibode/afc/qa/capability/route.ts");
  assert.match(route, /authorizeProductionAfcUser/);
  assert.match(
    source("lib/afc-v2-diagnostics/qa-capability.server.ts"),
    /if \(!auth\.ok\) return auth\.response/,
  );
});

test("25) authenticated eligible user → 200 { enabled: true }", async () => {
  const response = await getCapability({
    userId: ALLOWLISTED_USER,
    env: {
      VIBODE_AFC_QA_MODE: "allowlist",
      VIBODE_AFC_QA_USER_IDS: ALLOWLISTED_USER,
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await jsonBody(response), { enabled: true });
});

test("26) authenticated ineligible user → 200 { enabled: false }", async () => {
  const response = await getCapability({
    userId: OTHER_USER,
    env: {
      VIBODE_AFC_QA_MODE: "allowlist",
      VIBODE_AFC_QA_USER_IDS: ALLOWLISTED_USER,
    },
  });
  assert.equal(response.status, 200);
  assert.notEqual(response.status, 403);
  assert.deepEqual(await jsonBody(response), { enabled: false });
});

test("27) endpoint trusts authenticated user, not request user ID", async () => {
  const response = await getCapability({
    userId: OTHER_USER,
    url: `http://test/api/vibode/afc/qa/capability?userId=${ALLOWLISTED_USER}`,
    env: {
      VIBODE_AFC_QA_MODE: "allowlist",
      VIBODE_AFC_QA_USER_IDS: ALLOWLISTED_USER,
    },
  });
  assert.deepEqual(await jsonBody(response), { enabled: false });
  const capability = source("lib/afc-v2-diagnostics/qa-capability.server.ts");
  const route = source("app/api/vibode/afc/qa/capability/route.ts");
  assert.doesNotMatch(route, /searchParams|userIdFromRequest|record\.userId/);
  assert.match(capability, /resolveAfcQaCapability\(auth\.userId/);
});

test("28) response contains only enabled", async () => {
  const response = await getCapability({
    userId: ALLOWLISTED_USER,
    env: { VIBODE_AFC_QA_MODE: "all" },
  });
  const body = await jsonBody(response);
  assert.deepEqual(Object.keys(body), ["enabled"]);
  assert.equal(typeof body.enabled, "boolean");
});

test("29) no forbidden privacy keys", async () => {
  const response = await getCapability({
    userId: ALLOWLISTED_USER,
    env: {
      VIBODE_AFC_QA_MODE: "allowlist",
      VIBODE_AFC_QA_USER_IDS: `${ALLOWLISTED_USER},${OTHER_USER},${THIRD_USER}`,
    },
  });
  const body = await jsonBody(response);
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(
    serialized,
    /mode|allowlist|userId|roomId|diagnostic|engineFingerprint|storage|receipt|admin|email|partner/,
  );
  assert.equal(collectProductionPayloadPrivacyViolations(body).length, 0);
});

test("30) privacy assertion passes", () => {
  assert.doesNotThrow(() => freezeAfcQaCapability({ enabled: true }));
  assert.doesNotThrow(() => freezeAfcQaCapability({ enabled: false }));
  assertProductionPayloadPrivacy({ enabled: true });
  assertProductionPayloadPrivacy({ enabled: false });
});

test("31) analyze response shape unchanged", () => {
  const analyze = source("app/api/vibode/afc/analyze/route.ts");
  const adapter = source("lib/afc-v2-production/production-adapter.server.ts");
  const publicResponse = adapter.slice(
    adapter.indexOf("function publicResponse"),
    adapter.indexOf("async function resolveOriginalIdentity"),
  );
  assert.match(publicResponse, /status: input\.status/);
  assert.match(publicResponse, /generationId: input\.generationId/);
  assert.match(publicResponse, /currentGenerationId: input\.currentGenerationId/);
  assert.match(publicResponse, /authority: input\.authority/);
  assert.match(publicResponse, /failureReason: input\.failureReason/);
  assert.match(publicResponse, /frame: input\.frame/);
  assert.doesNotMatch(publicResponse, /enabled/);
  assert.doesNotMatch(analyze, /enabled|qa-capability|VIBODE_AFC_QA_/);
});

test("32) restore response shape unchanged", () => {
  const restore = source("app/api/vibode/afc/restore/route.ts");
  assert.match(restore, /restoreProductionAfcRoom/);
  assert.doesNotMatch(restore, /enabled|qa-capability|VIBODE_AFC_QA_/);
});

test("33) runtime response shape unchanged", () => {
  const runtime = source("app/api/vibode/afc/runtime/route.ts");
  assert.match(runtime, /restoreProductionAfcRoom/);
  assert.match(runtime, /originalImageUrl/);
  assert.doesNotMatch(runtime, /enabled|qa-capability|VIBODE_AFC_QA_/);
});

test("34) no production analyze path imports/calls QA capability", () => {
  const files = [
    "app/api/vibode/afc/analyze/route.ts",
    "lib/afc-v2-production/production-adapter.server.ts",
    "lib/afc-v2-production/production-persistence.server.ts",
    "lib/afc-v2-production/engine-fingerprint.ts",
  ];
  for (const file of files) {
    const text = source(file);
    assert.doesNotMatch(text, /qa-capability|resolveAfcQaCapability|VIBODE_AFC_QA_/);
  }
});

test("35) no diagnostic session tables are written", () => {
  const capability = source("lib/afc-v2-diagnostics/qa-capability.server.ts");
  const route = source("app/api/vibode/afc/qa/capability/route.ts");
  assert.doesNotMatch(
    `${capability}\n${route}`,
    /vibode_afc_diagnostic_sessions|vibode_afc_diagnostic_session_generations|vibode_afc_diagnostic_cases/,
  );
  assert.doesNotMatch(`${capability}\n${route}`, /\.insert\(|from\("/);
});

test("36) no new DB migration", () => {
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations")).filter(
    (name) => name.endsWith(".sql"),
  );
  assert.ok(
    !migrations.some((name) => /qa|capability|allowlist/i.test(name)),
  );
  for (const name of migrations) {
    if (name.includes("diagnostic_foundation") || name.includes("engine_fingerprint")) {
      continue;
    }
    const sql = source(`supabase/migrations/${name}`);
    assert.doesNotMatch(sql, /VIBODE_AFC_QA_MODE|VIBODE_AFC_QA_USER_IDS/);
  }
});

test("37) AFD-1B engine fingerprint behavior unchanged", () => {
  const fingerprint = source("lib/afc-v2-production/engine-fingerprint.ts");
  assert.match(fingerprint, /afc-v2-engine-fingerprint\/v1/);
  assert.doesNotMatch(fingerprint, /qa-capability|VIBODE_AFC_QA_|enabled/);
});

test("38) parent-generation/activation behavior unchanged", () => {
  const persistence = source("lib/afc-v2-production/production-persistence.server.ts");
  const store = source("lib/afc-v2-production/production-store.ts");
  const productionMigration = source(
    "supabase/migrations/20260908213000_vibode_afc_v2_production_generations.sql",
  );
  assert.match(persistence, /parent_generation_id: input\.parentGenerationId/);
  assert.match(store, /parentGenerationId/);
  assert.match(
    productionMigration,
    /create or replace function public\.activate_vibode_afc_generation/,
  );
  assert.match(productionMigration, /current_afc_generation_id/);
  assert.doesNotMatch(persistence, /qa-capability|VIBODE_AFC_QA_/);
  assert.doesNotMatch(store, /qa-capability|VIBODE_AFC_QA_/);
});

test("capability off is the default and all enables only authenticated identity", async () => {
  assert.deepEqual(
    resolveAfcQaCapability(ALLOWLISTED_USER, {}),
    { enabled: false },
  );
  const enabled = await getCapability({
    userId: OTHER_USER,
    env: { VIBODE_AFC_QA_MODE: "all" },
  });
  assert.deepEqual(await jsonBody(enabled), { enabled: true });
  assert.deepEqual(
    resolveAfcQaCapability("not-a-user", { VIBODE_AFC_QA_MODE: "all" }),
    { enabled: false },
  );
});

test("capability is not launch-ready and does not implement AFD-1D cleanup", () => {
  const capability = source("lib/afc-v2-diagnostics/qa-capability.server.ts");
  assert.match(capability, /not\s+launch-ready/);
  assert.match(capability, /user-deletion cleanup/);
  assert.match(capability, /AFD-1D/);
  assert.doesNotMatch(capability, /delete-user|listUserAfcObjects|removeUser/);
  const deleteUser = source("app/api/admin/delete-user/route.ts");
  assert.doesNotMatch(deleteUser, /qa-capability|VIBODE_AFC_QA_/);
});

test("capability route is GET-only and has no Editor wiring", () => {
  const route = source("app/api/vibode/afc/qa/capability/route.ts");
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function POST|export async function PUT/);
  const editor = source("app/editor/page.tsx");
  const prepareHook = source("lib/afc-v2-runtime/use-prepare-3d-room.ts");
  assert.doesNotMatch(editor, /\/api\/vibode\/afc\/qa\/capability|qa-capability/);
  assert.doesNotMatch(prepareHook, /\/api\/vibode\/afc\/qa\/capability|qa-capability/);
});

test("ordinary capability evaluation does not log", () => {
  const capability = source("lib/afc-v2-diagnostics/qa-capability.server.ts");
  const route = source("app/api/vibode/afc/qa/capability/route.ts");
  assert.doesNotMatch(`${capability}\n${route}`, /console\.(log|info|warn|error|debug)/);
});
