import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import path from "node:path";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AfcDiagnosticsAdminAuth } from "./admin-auth.server";
import {
  afcQaAccessConfig,
  resolveAfcQaCapabilityForConfig,
} from "./qa-access";
import {
  AFC_QA_ACCESS_MIGRATION,
  AFC_QA_SETTINGS_TABLE,
  AFC_QA_USERS_TABLE,
  addAfcQaUserByEmail,
  createAfcQaDirectory,
  handleAfcQaAccessAdd,
  handleAfcQaAccessGet,
  handleAfcQaAccessRemove,
  handleAfcQaAccessSetMode,
  readAfcQaAccessConfig,
  removeAfcQaUser,
  setAfcQaModeEnabled,
  type AfcQaAuthAdmin,
  type AfcQaDirectory,
} from "./qa-access.server";
import { resolveAfcQaCapability } from "./qa-capability.server";

const ROOT = process.cwd();
const USER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ADMIN = "55555555-5555-4555-8555-555555555555";

type SettingsRow = {
  id: string;
  qa_mode_enabled: boolean;
  updated_at: string;
};

type UserRow = {
  user_id: string;
  email_snapshot: string | null;
  added_at: string;
  added_by: string | null;
};

function source(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function memoryClient() {
  let settings: SettingsRow | null = {
    id: "global",
    qa_mode_enabled: false,
    updated_at: "2026-10-05T00:00:00.000Z",
  };
  const users: UserRow[] = [];
  let fail = false;
  const client = {
    from(table: string) {
      const failed = () => ({ data: null, error: { message: "relation does not exist", code: "42P01" } });
      return {
        select() {
          const filters: Array<[string, unknown]> = [];
          const rows = () => {
            if (fail) return failed();
            if (table === AFC_QA_SETTINGS_TABLE) {
              let matched = settings ? [settings] : [];
              for (const [column, value] of filters) {
                matched = matched.filter((row) => (row as Record<string, unknown>)[column] === value);
              }
              return { data: matched, error: null };
            }
            if (table === AFC_QA_USERS_TABLE) {
              let matched = users.slice();
              for (const [column, value] of filters) {
                matched = matched.filter((row) => (row as Record<string, unknown>)[column] === value);
              }
              matched.sort((a, b) => a.added_at.localeCompare(b.added_at));
              return { data: matched, error: null };
            }
            return failed();
          };
          const builder = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return builder;
            },
            order() {
              return builder;
            },
            async maybeSingle() {
              const result = rows();
              if (result.error) return result;
              return { data: result.data?.[0] ?? null, error: null };
            },
            then(
              onFulfilled: (value: unknown) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) {
              return Promise.resolve(rows()).then(onFulfilled, onRejected);
            },
          };
          return builder;
        },
        upsert(row: SettingsRow) {
          if (fail) return Promise.resolve({ error: { message: "relation does not exist", code: "42P01" } });
          settings = { ...row };
          return Promise.resolve({ error: null });
        },
        insert(row: UserRow) {
          if (fail) return Promise.resolve({ error: { message: "relation does not exist", code: "42P01" } });
          if (users.some((user) => user.user_id === row.user_id)) {
            return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
          }
          users.push({ ...row });
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            eq(column: string, value: unknown) {
              return {
                async select() {
                  if (fail) return { data: null, error: { message: "relation does not exist" } };
                  const removed = users.filter((row) => (row as Record<string, unknown>)[column] === value);
                  for (let index = users.length - 1; index >= 0; index -= 1) {
                    if ((users[index] as Record<string, unknown>)[column] === value) users.splice(index, 1);
                  }
                  return { data: removed, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  return {
    client: client as unknown as SupabaseClient,
    users: () => users,
    settings: () => settings,
    fail() {
      fail = true;
    },
  };
}

function directory(accounts: Record<string, string>): AfcQaDirectory {
  return {
    async findByEmail(email) {
      const target = email.trim().toLowerCase();
      const matches = Object.entries(accounts)
        .filter(([, accountEmail]) => accountEmail.toLowerCase() === target)
        .map(([userId, accountEmail]) => ({ userId, email: accountEmail }));
      if (matches.length > 1) return { ok: false, reason: "ambiguous" };
      return { ok: true, user: matches[0] ?? null };
    },
    async findById(userId) {
      const email = accounts[userId];
      return email ? { email } : null;
    },
  };
}

function storeFor(memory = memoryClient(), accounts: Record<string, string> = { [USER]: "qa@example.com" }) {
  return {
    memory,
    store: {
      client: memory.client,
      directory: directory(accounts),
      addedBy: ADMIN,
    },
  };
}

function denyAdmin(): () => Promise<AfcDiagnosticsAdminAuth> {
  return async () => ({
    ok: false,
    response: NextResponse.json({ error: "Admin access required." }, { status: 403 }),
  });
}

function allowAdmin(): () => Promise<AfcDiagnosticsAdminAuth> {
  return async () => ({
    ok: true,
    admin: { userId: ADMIN, email: "admin@example.com" },
  });
}

test("QA mode disabled denies an allowlisted user", async () => {
  const { memory, store } = storeFor();
  const added = await addAfcQaUserByEmail("qa@example.com", store);
  assert.equal(added.ok, true);
  const disabled = await setAfcQaModeEnabled(false, store);
  assert.equal(disabled.ok, true);
  if (!disabled.ok) return;
  assert.equal(disabled.snapshot.qaModeEnabled, false);
  assert.equal(disabled.snapshot.users.length, 1);
  const config = await readAfcQaAccessConfig(memory.client);
  assert.equal(resolveAfcQaCapabilityForConfig(USER, config).enabled, false);
  assert.equal(
    resolveAfcQaCapabilityForConfig(USER, afcQaAccessConfig(false, USER)).enabled,
    false,
  );
});

test("QA mode enabled allows only allowlisted users", async () => {
  const { memory, store } = storeFor();
  assert.equal((await setAfcQaModeEnabled(true, store)).ok, true);
  assert.equal((await addAfcQaUserByEmail("QA@example.com", store)).ok, true);
  const config = await readAfcQaAccessConfig(memory.client);
  assert.equal((await resolveAfcQaCapability(USER, config)).enabled, true);
  assert.equal(resolveAfcQaCapabilityForConfig(OTHER, config).enabled, false);
  assert.equal(memory.users()[0]?.user_id, USER);
  assert.notEqual(memory.users()[0]?.user_id, "qa@example.com");
});

test("duplicate add is rejected and removal revokes access", async () => {
  const { memory, store } = storeFor();
  await setAfcQaModeEnabled(true, store);
  const first = await addAfcQaUserByEmail("qa@example.com", store);
  assert.equal(first.ok, true);
  const duplicate = await addAfcQaUserByEmail("qa@example.com", store);
  assert.equal(duplicate.ok, false);
  if (duplicate.ok) return;
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.error, "This user already has AFC QA access.");
  assert.equal(memory.users().length, 1);
  assert.equal((await readAfcQaAccessConfig(memory.client)).allowlist.has(USER), true);

  const removed = await removeAfcQaUser(USER.toUpperCase(), store);
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.equal(removed.snapshot.users.length, 0);
  const config = await readAfcQaAccessConfig(memory.client);
  assert.equal(resolveAfcQaCapabilityForConfig(USER, config).enabled, false);
  const missing = await removeAfcQaUser(USER, store);
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.status, 404);
});

test("invalid and unknown accounts fail without changing the allowlist", async () => {
  const { memory, store } = storeFor();
  await setAfcQaModeEnabled(true, store);
  const invalid = await addAfcQaUserByEmail("not-an-email", store);
  assert.equal(invalid.ok, false);
  if (invalid.ok) return;
  assert.equal(invalid.status, 400);
  assert.equal(invalid.error, "Enter a valid email address.");
  const missing = await addAfcQaUserByEmail("missing@example.com", store);
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.status, 404);
  assert.equal(missing.error, "No Vibode account matches that email.");
  assert.equal(memory.users().length, 0);
  assert.equal((await readAfcQaAccessConfig(memory.client)).allowlist.size, 0);
});

test("admin management rejects non-admin access before mutation", async () => {
  const memory = memoryClient();
  let touched = false;
  const client = {
    from() {
      touched = true;
      throw new Error("non-admin must not touch QA access storage");
    },
  } as unknown as SupabaseClient;
  const authorize = denyAdmin();
  for (const response of [
    await handleAfcQaAccessGet({ authorize, client }),
    await handleAfcQaAccessSetMode({
      authorize,
      client,
      request: new Request("http://test/afc-qa-access", {
        method: "PATCH",
        body: JSON.stringify({ qaModeEnabled: true }),
      }),
    }),
    await handleAfcQaAccessAdd({
      authorize,
      client,
      request: new Request("http://test/afc-qa-access", {
        method: "POST",
        body: JSON.stringify({ email: "qa@example.com" }),
      }),
    }),
    await handleAfcQaAccessRemove({
      authorize,
      client,
      request: new Request("http://test/afc-qa-access", {
        method: "DELETE",
        body: JSON.stringify({ userId: USER }),
      }),
    }),
  ]) {
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Admin access required." });
  }
  assert.equal(touched, false);
  assert.equal(memory.settings()?.qa_mode_enabled, false);
});

test("configuration changes are visible on the next read without a cache", async () => {
  const { memory, store } = storeFor();
  assert.equal((await readAfcQaAccessConfig(memory.client)).qaModeEnabled, false);
  await setAfcQaModeEnabled(true, store);
  await addAfcQaUserByEmail("qa@example.com", store);
  const enabled = await readAfcQaAccessConfig(memory.client);
  assert.equal(resolveAfcQaCapabilityForConfig(USER, enabled).enabled, true);
  await setAfcQaModeEnabled(false, store);
  const disabled = await readAfcQaAccessConfig(memory.client);
  assert.equal(resolveAfcQaCapabilityForConfig(USER, disabled).enabled, false);
  const implementation = [
    source("lib/afc-v2-diagnostics/qa-access.server.ts"),
    source("lib/afc-v2-diagnostics/qa-capability.server.ts"),
  ].join("\n");
  assert.match(implementation, /readAfcQaAccessConfig\(/);
  assert.doesNotMatch(implementation, /unstable_cache|revalidateTag|lru-cache|Map\(\)/);
});

test("legacy environment values do not change authorization", async () => {
  const previousMode = process.env.VIBODE_AFC_QA_MODE;
  const previousIds = process.env.VIBODE_AFC_QA_USER_IDS;
  process.env.VIBODE_AFC_QA_MODE = "all";
  process.env.VIBODE_AFC_QA_USER_IDS = USER;
  try {
    const closed = await readAfcQaAccessConfig(null);
    assert.equal(closed.qaModeEnabled, false);
    assert.equal(resolveAfcQaCapabilityForConfig(USER, closed).enabled, false);
    const { memory, store } = storeFor();
    await setAfcQaModeEnabled(true, store);
    await addAfcQaUserByEmail("qa@example.com", store);
    process.env.VIBODE_AFC_QA_MODE = "off";
    delete process.env.VIBODE_AFC_QA_USER_IDS;
    const config = await readAfcQaAccessConfig(memory.client);
    assert.equal((await resolveAfcQaCapability(USER, config)).enabled, true);
    assert.equal(resolveAfcQaCapabilityForConfig(OTHER, config).enabled, false);
  } finally {
    if (previousMode === undefined) delete process.env.VIBODE_AFC_QA_MODE;
    else process.env.VIBODE_AFC_QA_MODE = previousMode;
    if (previousIds === undefined) delete process.env.VIBODE_AFC_QA_USER_IDS;
    else process.env.VIBODE_AFC_QA_USER_IDS = previousIds;
  }

  const runtime = [
    "lib/afc-v2-diagnostics/qa-access.ts",
    "lib/afc-v2-diagnostics/qa-access.server.ts",
    "lib/afc-v2-diagnostics/qa-capability.server.ts",
    "lib/afc-v2-diagnostics/session-lifecycle.server.ts",
    "lib/afc-v2-diagnostics/browser-qa-state.server.ts",
    "lib/afc-v2-diagnostics/submit-tester-case.server.ts",
    "lib/afc-v2-diagnostics/qa-rerun.server.ts",
    "lib/afc-v2-diagnostics/qa-reread-perspective.server.ts",
    "lib/afc-v2-diagnostics/manual-perspective.server.ts",
    "lib/afc-v2-diagnostics/manual-perspective-recovery.server.ts",
    "app/api/admin/afc-qa-access/route.ts",
    "app/admin/afc-diagnostics/AfcQaAccessSettings.tsx",
    ".env.example",
  ].map(source).join("\n");
  assert.doesNotMatch(runtime, /VIBODE_AFC_QA_MODE|VIBODE_AFC_QA_USER_IDS/);
});

test("admin handlers return the updated allowlist and hide auth internals", async () => {
  const { memory, store } = storeFor();
  const response = await handleAfcQaAccessAdd({
    authorize: allowAdmin(),
    client: memory.client,
    directory: store.directory,
    request: new Request("http://test/afc-qa-access", {
      method: "POST",
      body: JSON.stringify({ email: "qa@example.com" }),
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.qaModeEnabled, false);
  assert.equal(Array.isArray(body.users), true);
  const serialized = JSON.stringify(body);
  assert.match(serialized, /qa@example.com/);
  assert.doesNotMatch(serialized, /email_snapshot|added_by|service_role|app_metadata|access_token/);
});

test("email lookup finds a later page and rejects ambiguous matches", async () => {
  const target = { id: USER, email: "qa@example.com" };
  let listed = 0;
  const admin: AfcQaAuthAdmin = {
    async listUsers({ page = 1 }) {
      listed += 1;
      if (page === 1) {
        return {
          data: {
            users: Array.from({ length: 200 }, (_, index) => ({
              id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
              email: `person-${index}@example.com`,
            })),
          },
          error: null,
        };
      }
      return { data: { users: [target] }, error: null };
    },
    async getUserById() {
      return { data: { user: target }, error: null };
    },
  };
  const found = await createAfcQaDirectory(admin).findByEmail(" QA@example.com ");
  assert.equal(found.ok, true);
  if (!found.ok) return;
  assert.deepEqual(found.user, { userId: USER, email: "qa@example.com" });
  assert.equal(listed, 2);

  const ambiguous: AfcQaAuthAdmin = {
    async listUsers() {
      return {
        data: {
          users: [
            { id: USER, email: "qa@example.com" },
            { id: OTHER, email: "QA@example.com" },
          ],
        },
        error: null,
      };
    },
    async getUserById() {
      return { data: { user: null }, error: null };
    },
  };
  const clash = await createAfcQaDirectory(ambiguous).findByEmail("qa@example.com");
  assert.deepEqual(clash, { ok: false, reason: "ambiguous" });
});

test("QA access migration is service-role only and defaults mode off", () => {
  const sql = source(`supabase/migrations/${AFC_QA_ACCESS_MIGRATION}`);
  assert.match(sql, /qa_mode_enabled boolean not null default false/);
  assert.match(sql, /user_id uuid primary key references auth\.users \(id\) on delete cascade/);
  assert.match(sql, /email_snapshot text/);
  assert.match(sql, /revoke all on table public\.afc_qa_settings from public, anon, authenticated/);
  assert.match(sql, /revoke all on table public\.afc_qa_users from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update on table public\.afc_qa_settings to service_role/);
  assert.match(sql, /grant select, insert, delete on table public\.afc_qa_users to service_role/);
  assert.doesNotMatch(sql, /VIBODE_AFC_QA_MODE|VIBODE_AFC_QA_USER_IDS|primary key \(email/);
  const route = source("app/api/admin/afc-qa-access/route.ts");
  assert.match(route, /handleAfcQaAccessGet/);
  assert.match(route, /handleAfcQaAccessSetMode/);
  assert.match(route, /handleAfcQaAccessAdd/);
  assert.match(route, /handleAfcQaAccessRemove/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|VIBODE_AFC_QA_/);
  const ui = source("app/admin/afc-diagnostics/AfcQaAccessSettings.tsx");
  const inbox = source("app/admin/afc-diagnostics/AfcDiagnosticCaseInbox.tsx");
  assert.match(inbox, /<AfcQaAccessSettings/);
  assert.match(ui, /AFC QA Access/);
  assert.match(ui, /window\.confirm\(/);
  assert.match(ui, /\/api\/admin\/afc-qa-access/);
  assert.doesNotMatch(ui, /SUPABASE_SERVICE_ROLE_KEY|VIBODE_AFC_QA_|service_role/);
});
