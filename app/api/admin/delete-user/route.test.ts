import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createAdminDeleteUserPostHandler,
  type AdminDeleteUserHandlerDeps,
} from "./route";
import { AFC_V2_PRODUCTION_STORAGE_BUCKET } from "@/lib/afc-v2-production/production-store";

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "44444444-4444-4444-8444-444444444444";
const EMAIL_A = "user-a@example.test";

type OpSink = {
  ops: string[];
  removed: Array<{ bucket: string; paths: string[] }>;
};

function createThenBuilder(
  sink: OpSink,
  table: string,
  result: { data: unknown; error: null | { message: string }; count?: number },
) {
  const builder: Record<string, unknown> = {};
  builder.select = () => {
    sink.ops.push(`select:${table}`);
    return builder;
  };
  builder.delete = () => {
    sink.ops.push(`delete:${table}`);
    return builder;
  };
  builder.eq = () => builder;
  builder.limit = () => builder;
  builder.range = () => builder;
  builder.then = (
    resolve: (value: typeof result) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function createRouteSupabase(
  sink: OpSink,
  options: {
    afcListError?: { message: string };
    deleteAuthError?: { message?: unknown; status?: unknown; code?: unknown } & Record<
      string,
      unknown
    >;
    unsettledHold?: "clear" | "blocked" | "error" | "malformed";
    admission?: "ok" | "unsettled" | "busy" | "unavailable";
    removeError?: boolean;
    listError?: boolean;
    listedFile?: boolean;
  } = {},
) {
  const attemptId = "99999999-9999-4999-8999-999999999999";
  return {
    auth: {
      admin: {
        async getUserById(userId: string) {
          sink.ops.push("auth-get");
          if (userId !== USER_A) {
            return { data: { user: null }, error: { message: "missing" } };
          }
          return { data: { user: { id: USER_A, email: EMAIL_A } }, error: null };
        },
        async deleteUser(userId: string) {
          sink.ops.push(`auth-delete:${userId}`);
          if (options.deleteAuthError) {
            return { error: options.deleteAuthError };
          }
          return { error: null };
        },
      },
    },
    from(table: string) {
      sink.ops.push(`from:${table}`);
      return createThenBuilder(sink, table, { data: [], error: null, count: 1 });
    },
    async rpc(name: string) {
      sink.ops.push(`rpc:${name}`);
      if (name === "vibode_furniture_generation_account_has_unsettled_hold") {
        if (options.unsettledHold === "error") {
          return { data: null, error: { message: "users/secret/task-secret", code: "XX000" } };
        }
        if (options.unsettledHold === "malformed") {
          return { data: { ok: true }, error: null };
        }
        if (options.unsettledHold === "blocked") {
          return { data: { ok: true, blocked: true }, error: null };
        }
        return { data: { ok: true, blocked: false }, error: null };
      }
      if (name === "begin_vibode_account_deletion") {
        if (options.admission === "unsettled") {
          return { data: { ok: false, code: "unsettled_hold" }, error: null };
        }
        if (options.admission === "unavailable") {
          return { data: null, error: { message: "users/secret/model.glb", code: "XX000" } };
        }
        return {
          data: { ok: true, code: "begun", attempt_id: attemptId, phase: "admitted", claimed: false },
          error: null,
        };
      }
      if (name === "claim_vibode_account_deletion") {
        if (options.admission === "busy") {
          return { data: { ok: false, code: "deletion_in_progress" }, error: null };
        }
        return { data: { ok: true, phase: "admitted" }, error: null };
      }
      if (name === "mark_vibode_account_deletion_destructive") {
        return { data: { ok: true, phase: "destructive" }, error: null };
      }
      if (name === "release_vibode_account_deletion_claim" || name === "note_vibode_account_deletion_succeeded") {
        return { data: { ok: true }, error: null };
      }
      return { data: null, error: { message: "unexpected rpc", code: "XX000" } };
    },
    storage: {
      from(bucket: string) {
        sink.ops.push(`storage:${bucket}`);
        return {
          async list(path?: string) {
            sink.ops.push(`list:${bucket}:${path ?? ""}`);
            if (bucket === AFC_V2_PRODUCTION_STORAGE_BUCKET && options.afcListError) {
              return { data: null, error: options.afcListError };
            }
            if (bucket === "vibode-furniture-assets" && options.listError) {
              return { data: null, error: { message: "users/secret/model.glb" } };
            }
            if (bucket === "vibode-furniture-assets" && options.listedFile && path === `users/${USER_A}`) {
              return { data: [{ name: "model.glb", metadata: { size: 4 } }], error: null };
            }
            return { data: [], error: null };
          },
          async remove(paths: string[]) {
            sink.ops.push(`remove:${bucket}`);
            sink.removed.push({ bucket, paths });
            if (options.removeError) {
              return { error: { message: "users/secret/model.glb" } };
            }
            return { error: null };
          },
        };
      },
    },
  };
}

function handler(args: {
  sink: OpSink;
  deleteAfcV2UserStorage?: AdminDeleteUserHandlerDeps["deleteAfcV2UserStorage"];
}) {
  return createAdminDeleteUserPostHandler({
    getAuthenticatedAdminUser: async () =>
      ({ id: ADMIN_ID, email: "admin@example.test" }) as never,
    getServiceRoleSupabaseClient: () => createRouteSupabase(args.sink) as never,
    deleteAfcV2UserStorage: args.deleteAfcV2UserStorage,
  });
}

async function post(
  route: ReturnType<typeof createAdminDeleteUserPostHandler>,
  body: Record<string, unknown>,
) {
  return route(
    new Request("http://test/api/admin/delete-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function jsonBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test("13) browser/request cannot inject an extra object path", async () => {
  const sink: OpSink = { ops: [], removed: [] };
  let seenUserId: string | null = null;
  const route = handler({
    sink,
    deleteAfcV2UserStorage: async ({ userId }) => {
      seenUserId = userId;
      sink.ops.push("afc-cleanup");
      return { ok: true, deleted: 1, skipped: 0 };
    },
  });
  const injected = `users/${USER_B}/rooms/${USER_B}/afc/${USER_B}/empty.png`;
  const response = await post(route, {
    userId: USER_A,
    confirmEmail: EMAIL_A,
    objectPaths: [injected],
    paths: [injected],
  });
  const body = await jsonBody(response);
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(seenUserId, USER_A);
  assert.equal(
    JSON.stringify(body).includes(injected),
    false,
  );
  assert.equal(
    sink.removed.some((entry) => entry.paths.includes(injected)),
    false,
  );
});

test("14) browser/request cannot choose bucket", async () => {
  const sink: OpSink = { ops: [], removed: [] };
  const route = handler({
    sink,
    deleteAfcV2UserStorage: async () => {
      sink.ops.push("afc-cleanup");
      return { ok: true, deleted: 0, skipped: 0 };
    },
  });
  const response = await post(route, {
    userId: USER_A,
    confirmEmail: EMAIL_A,
    bucket: "other-bucket",
    storageBucket: AFC_V2_PRODUCTION_STORAGE_BUCKET,
  });
  assert.equal(response.status, 200);
  assert.equal(
    sink.removed.some((entry) => entry.bucket === "other-bucket"),
    false,
  );
  assert.equal(sink.ops.includes("storage:other-bucket"), false);
});

test("15) browser/request cannot override deletion target identity", async () => {
  const sink: OpSink = { ops: [], removed: [] };
  let seenUserId: string | null = null;
  const route = handler({
    sink,
    deleteAfcV2UserStorage: async ({ userId }) => {
      seenUserId = userId;
      sink.ops.push("afc-cleanup");
      return { ok: true, deleted: 0, skipped: 0 };
    },
  });
  const response = await post(route, {
    userId: USER_A,
    confirmEmail: EMAIL_A,
    targetUserId: USER_B,
    otherUserId: USER_B,
  });
  assert.equal(response.status, 200);
  assert.equal(seenUserId, USER_A);
  const authDelete = sink.ops.find((op) => op.startsWith("auth-delete:"));
  assert.equal(authDelete, `auth-delete:${USER_A}`);
});

test("16) AFC storage cleanup runs before DB/auth deletion", async () => {
  const sink: OpSink = { ops: [], removed: [] };
  const route = handler({
    sink,
    deleteAfcV2UserStorage: async () => {
      sink.ops.push("afc-cleanup");
      return { ok: true, deleted: 3, skipped: 0 };
    },
  });
  const response = await post(route, {
    userId: USER_A,
    confirmEmail: EMAIL_A,
  });
  assert.equal(response.status, 200);
  const afcAt = sink.ops.indexOf("afc-cleanup");
  const roomsDeleteAt = sink.ops.indexOf("delete:vibode_rooms");
  const authDeleteAt = sink.ops.indexOf(`auth-delete:${USER_A}`);
  assert.ok(afcAt >= 0);
  assert.ok(roomsDeleteAt > afcAt);
  assert.ok(authDeleteAt > roomsDeleteAt);
  assert.ok(sink.ops.indexOf("auth-get") < afcAt);
});

test("17) zero AFC objects does not block normal deletion", async () => {
  const sink: OpSink = { ops: [], removed: [] };
  const route = handler({
    sink,
    deleteAfcV2UserStorage: async () => {
      sink.ops.push("afc-cleanup");
      return { ok: true, deleted: 0, skipped: 0 };
    },
  });
  const response = await post(route, {
    userId: USER_A,
    confirmEmail: EMAIL_A,
  });
  const body = await jsonBody(response);
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.authUserDeleted, true);
  assert.equal(body.deletedStorageFiles, 0);
});

test("18) successful AFC cleanup preserves existing delete-user success behavior", async () => {
  const sink: OpSink = { ops: [], removed: [] };
  const route = handler({
    sink,
    deleteAfcV2UserStorage: async () => ({ ok: true, deleted: 4, skipped: 1 }),
  });
  const response = await post(route, {
    userId: USER_A,
    confirmEmail: EMAIL_A,
  });
  const body = await jsonBody(response);
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), [
    "authUserDeleted",
    "deletedRowsByTable",
    "deletedStorageFiles",
    "skippedStorageFiles",
    "success",
  ]);
  assert.equal(body.success, true);
  assert.equal(body.authUserDeleted, true);
  assert.equal(body.deletedStorageFiles, 4);
  assert.equal(body.skippedStorageFiles, 1);
  assert.equal(typeof body.deletedRowsByTable, "object");
});

test("19) storage cleanup failure does not return false success", async () => {
  const sink: OpSink = { ops: [], removed: [] };
  const route = handler({
    sink,
    deleteAfcV2UserStorage: async () => ({ ok: false, deleted: 1, skipped: 0 }),
  });
  const response = await post(route, {
    userId: USER_A,
    confirmEmail: EMAIL_A,
  });
  const body = await jsonBody(response);
  assert.equal(response.status, 500);
  assert.equal(body.success, undefined);
  assert.equal(body.error, "Failed deleting AFC storage.");
  assert.equal(body.authUserDeleted, undefined);
  assert.equal(sink.ops.includes(`auth-delete:${USER_A}`), false);
  assert.equal(sink.ops.includes("delete:vibode_rooms"), false);
  assert.equal(JSON.stringify(body).includes("users/"), false);
});

test("delete-user still requires admin, matching email, and rejects self-delete", async () => {
  const sink: OpSink = { ops: [], removed: [] };
  const unauthorized = createAdminDeleteUserPostHandler({
    getAuthenticatedAdminUser: async () => null,
    getServiceRoleSupabaseClient: () => createRouteSupabase(sink) as never,
  });
  assert.equal(
    (await post(unauthorized, { userId: USER_A, confirmEmail: EMAIL_A })).status,
    403,
  );

  const selfDelete = createAdminDeleteUserPostHandler({
    getAuthenticatedAdminUser: async () => ({ id: USER_A }) as never,
    getServiceRoleSupabaseClient: () => createRouteSupabase(sink) as never,
  });
  assert.equal(
    (await post(selfDelete, { userId: USER_A, confirmEmail: EMAIL_A })).status,
    400,
  );

  const mismatch = handler({ sink });
  assert.equal(
    (await post(mismatch, { userId: USER_A, confirmEmail: "other@example.test" }))
      .status,
    400,
  );
});

test("auth delete failure keeps browser JSON and logs only message/status/code", async () => {
  const sink: OpSink = { ops: [], removed: [] };
  const logs: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };
  try {
    const route = createAdminDeleteUserPostHandler({
      getAuthenticatedAdminUser: async () =>
        ({ id: ADMIN_ID, email: "admin@example.test" }) as never,
      getServiceRoleSupabaseClient: () =>
        createRouteSupabase(sink, {
          deleteAuthError: {
            message: "Database error deleting user",
            status: 500,
            code: "unexpected_failure",
            email: EMAIL_A,
            userId: USER_A,
            raw: { token: "secret-token" },
          },
        }) as never,
      deleteAfcV2UserStorage: async () => {
        sink.ops.push("afc-cleanup");
        return { ok: true, deleted: 2, skipped: 0 };
      },
    });
    const response = await post(route, {
      userId: USER_A,
      confirmEmail: EMAIL_A,
    });
    const body = await jsonBody(response);
    const serialized = JSON.stringify(body);
    assert.equal(response.status, 500);
    assert.deepEqual(Object.keys(body).sort(), [
      "authUserDeleted",
      "deletedRowsByTable",
      "deletedStorageFiles",
      "error",
      "skippedStorageFiles",
    ]);
    assert.equal(body.error, "Failed deleting auth user.");
    assert.equal(body.authUserDeleted, false);
    assert.equal(body.deletedStorageFiles, 2);
    assert.equal(serialized.includes(EMAIL_A), false);
    assert.equal(sink.ops.includes(`auth-delete:${USER_A}`), true);
    const afcAt = sink.ops.indexOf("afc-cleanup");
    const authDeleteAt = sink.ops.indexOf(`auth-delete:${USER_A}`);
    assert.ok(afcAt >= 0);
    assert.ok(authDeleteAt > afcAt);

    const authLogs = logs.filter(
      (args) => args[0] === "[admin/delete-user] auth delete failed",
    );
    assert.equal(authLogs.length, 1);
    const payload = authLogs[0]?.[1];
    assert.equal(payload !== null && typeof payload === "object", true);
    assert.deepEqual(Object.keys(payload as object).sort(), [
      "code",
      "message",
      "status",
    ]);
    assert.deepEqual(payload, {
      message: "Database error deleting user",
      status: 500,
      code: "unexpected_failure",
    });
    const logged = JSON.stringify(payload);
    assert.equal(logged.includes(EMAIL_A), false);
    assert.equal(logged.includes(USER_A), false);
    assert.equal(logged.includes("secret-token"), false);
  } finally {
    console.error = originalError;
  }
});

test("FIX1 8/12 prefix listing failure blocks success and hides storage paths", async () => {
  const sink: OpSink = { ops: [], removed: [] };
  const route = createAdminDeleteUserPostHandler({
    getAuthenticatedAdminUser: async () =>
      ({ id: ADMIN_ID, email: "admin@example.test" }) as never,
    getServiceRoleSupabaseClient: () =>
      createRouteSupabase(sink, {
        afcListError: { message: "storage listing timeout" },
      }) as never,
  });
  const response = await post(route, {
    userId: USER_A,
    confirmEmail: EMAIL_A,
    objectPaths: [`users/${USER_B}/secret.png`],
  });
  const body = await jsonBody(response);
  const serialized = JSON.stringify(body);
  assert.equal(response.status, 500);
  assert.equal(body.success, undefined);
  assert.equal(body.error, "Failed deleting AFC storage.");
  assert.equal(sink.ops.includes(`auth-delete:${USER_A}`), false);
  assert.equal(sink.ops.includes("delete:vibode_rooms"), false);
  assert.equal(serialized.includes("users/"), false);
  assert.equal(serialized.includes("storage listing timeout"), false);
  assert.equal(serialized.includes(AFC_V2_PRODUCTION_STORAGE_BUCKET), false);
});

const UNSETTLED_MESSAGE =
  "This account has an unresolved AI furniture generation. Resolve the generation before deleting the account.";

test("unsettled generation hold is rejected before storage and auth deletion", async () => {
  const sink: OpSink = { ops: [], removed: [] };
  let afcCalls = 0;
  const route = createAdminDeleteUserPostHandler({
    getAuthenticatedAdminUser: async () =>
      ({ id: ADMIN_ID, email: "admin@example.test" }) as never,
    getServiceRoleSupabaseClient: () =>
      createRouteSupabase(sink, { unsettledHold: "blocked" }) as never,
    deleteAfcV2UserStorage: async () => {
      afcCalls += 1;
      sink.ops.push("afc-cleanup");
      return { ok: true, deleted: 4, skipped: 0 };
    },
  });
  const first = await post(route, { userId: USER_A, confirmEmail: EMAIL_A });
  const firstBody = await jsonBody(first);
  assert.equal(first.status, 409);
  assert.equal(firstBody.error, UNSETTLED_MESSAGE);
  assert.equal(firstBody.success, undefined);
  assert.equal(JSON.stringify(firstBody).includes("task"), false);
  assert.equal(JSON.stringify(firstBody).includes("users/"), false);
  assert.equal(afcCalls, 0);
  assert.equal(sink.removed.length, 0);
  assert.equal(sink.ops.includes(`auth-delete:${USER_A}`), false);
  assert.equal(sink.ops.includes("delete:vibode_rooms"), false);
  assert.equal(sink.ops.some((op) => op.startsWith("storage:")), false);
  assert.equal(sink.ops.some((op) => op.startsWith("remove:")), false);
  const rpcAt = sink.ops.indexOf("rpc:vibode_furniture_generation_account_has_unsettled_hold");
  const authGetAt = sink.ops.indexOf("auth-get");
  assert.ok(authGetAt >= 0);
  assert.ok(rpcAt > authGetAt);

  const second = await post(route, { userId: USER_A, confirmEmail: EMAIL_A });
  const secondBody = await jsonBody(second);
  assert.equal(second.status, 409);
  assert.equal(secondBody.error, UNSETTLED_MESSAGE);
  assert.equal(afcCalls, 0);
  assert.equal(sink.removed.length, 0);
  assert.equal(sink.ops.includes(`auth-delete:${USER_A}`), false);
});

test("an unreadable generation hold check blocks deletion before storage", async () => {
  const sink: OpSink = { ops: [], removed: [] };
  const logs: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };
  try {
    const route = createAdminDeleteUserPostHandler({
      getAuthenticatedAdminUser: async () =>
        ({ id: ADMIN_ID, email: "admin@example.test" }) as never,
      getServiceRoleSupabaseClient: () =>
        createRouteSupabase(sink, { unsettledHold: "error" }) as never,
      deleteAfcV2UserStorage: async () => {
        sink.ops.push("afc-cleanup");
        return { ok: true, deleted: 1, skipped: 0 };
      },
    });
    const response = await post(route, { userId: USER_A, confirmEmail: EMAIL_A });
    const body = await jsonBody(response);
    assert.equal(response.status, 500);
    assert.equal(body.error, "Account deletion could not be checked.");
    assert.equal(JSON.stringify(body).includes("users/"), false);
    assert.equal(JSON.stringify(body).includes("task-secret"), false);
    assert.equal(sink.ops.includes("afc-cleanup"), false);
    assert.equal(sink.ops.includes(`auth-delete:${USER_A}`), false);
    assert.equal(sink.removed.length, 0);
    const logged = JSON.stringify(logs);
    assert.equal(logged.includes("users/"), false);
    assert.equal(logged.includes("task-secret"), false);
  } finally {
    console.error = originalError;
  }
});

test("a deletion barrier is committed before storage cleanup and released after failure", async () => {
  const attemptId = "99999999-9999-4999-8999-999999999999";
  const blocked: OpSink = { ops: [], removed: [] };
  const lateHold = createAdminDeleteUserPostHandler({
    getAuthenticatedAdminUser: async () => ({ id: ADMIN_ID, email: "admin@example.test" }) as never,
    getServiceRoleSupabaseClient: () => createRouteSupabase(blocked, { admission: "unsettled" }) as never,
    deleteAfcV2UserStorage: async () => {
      blocked.ops.push("afc-cleanup");
      return { ok: true, deleted: 1, skipped: 0 };
    },
  });
  const late = await post(lateHold, { userId: USER_A, confirmEmail: EMAIL_A });
  const lateBody = await jsonBody(late);
  assert.equal(late.status, 409);
  assert.equal(lateBody.error, "This account has an unresolved AI furniture generation. Resolve the generation before deleting the account.");
  assert.equal(blocked.ops.includes("afc-cleanup"), false);
  assert.equal(blocked.removed.length, 0);
  assert.equal(blocked.ops.includes("rpc:begin_vibode_account_deletion"), true);
  assert.equal(blocked.ops.includes("rpc:claim_vibode_account_deletion"), false);

  const busySink: OpSink = { ops: [], removed: [] };
  const busyRoute = createAdminDeleteUserPostHandler({
    getAuthenticatedAdminUser: async () => ({ id: ADMIN_ID, email: "admin@example.test" }) as never,
    getServiceRoleSupabaseClient: () => createRouteSupabase(busySink, { admission: "busy" }) as never,
    deleteAfcV2UserStorage: async () => {
      busySink.ops.push("afc-cleanup");
      return { ok: true, deleted: 1, skipped: 0 };
    },
  });
  const busy = await post(busyRoute, { userId: USER_A, confirmEmail: EMAIL_A });
  const busyBody = await jsonBody(busy);
  assert.equal(busy.status, 409);
  assert.equal(busyBody.attemptId, attemptId);
  assert.equal(String(busyBody.error).includes(attemptId), true);
  assert.equal(JSON.stringify(busyBody).includes("users/"), false);
  assert.equal(busySink.ops.includes("afc-cleanup"), false);
  assert.equal(busySink.ops.includes("rpc:release_vibode_account_deletion_claim"), false);

  const failedSink: OpSink = { ops: [], removed: [] };
  const failedRoute = createAdminDeleteUserPostHandler({
    getAuthenticatedAdminUser: async () => ({ id: ADMIN_ID, email: "admin@example.test" }) as never,
    getServiceRoleSupabaseClient: () =>
      createRouteSupabase(failedSink, { listedFile: true, removeError: true }) as never,
    deleteAfcV2UserStorage: async () => ({ ok: true, deleted: 0, skipped: 0 }),
  });
  const failed = await post(failedRoute, { userId: USER_A, confirmEmail: EMAIL_A });
  const failedBody = await jsonBody(failed);
  assert.equal(failed.status, 500);
  assert.equal(String(failedBody.error).includes("users/"), false);
  assert.equal(String(failedBody.error).includes("model.glb"), false);
  assert.equal(failedBody.authUserDeleted, false);
  assert.equal(failedSink.ops.includes(`auth-delete:${USER_A}`), false);
  assert.equal(failedSink.ops.includes("rpc:release_vibode_account_deletion_claim"), true);
  assert.equal(failedSink.ops.includes("rpc:note_vibode_account_deletion_succeeded"), false);
  assert.equal(failedSink.removed.length, 1);

  const listedSink: OpSink = { ops: [], removed: [] };
  const listedRoute = createAdminDeleteUserPostHandler({
    getAuthenticatedAdminUser: async () => ({ id: ADMIN_ID, email: "admin@example.test" }) as never,
    getServiceRoleSupabaseClient: () => createRouteSupabase(listedSink, { listError: true }) as never,
    deleteAfcV2UserStorage: async () => ({ ok: true, deleted: 0, skipped: 0 }),
  });
  const listed = await post(listedRoute, { userId: USER_A, confirmEmail: EMAIL_A });
  const listedBody = await jsonBody(listed);
  assert.equal(listed.status, 500);
  assert.equal(listedBody.error, "Furniture storage cleanup failed. Account deletion was not finished.");
  assert.equal(JSON.stringify(listedBody).includes("secret"), false);
  assert.equal(listedSink.ops.includes("rpc:release_vibode_account_deletion_claim"), true);
  assert.equal(listedSink.ops.includes(`auth-delete:${USER_A}`), false);

  const authSink: OpSink = { ops: [], removed: [] };
  const authRoute = createAdminDeleteUserPostHandler({
    getAuthenticatedAdminUser: async () => ({ id: ADMIN_ID, email: "admin@example.test" }) as never,
    getServiceRoleSupabaseClient: () =>
      createRouteSupabase(authSink, { deleteAuthError: { message: "users/secret", code: "XX000" } }) as never,
    deleteAfcV2UserStorage: async () => ({ ok: true, deleted: 0, skipped: 0 }),
  });
  const authFailed = await post(authRoute, { userId: USER_A, confirmEmail: EMAIL_A });
  const authBody = await jsonBody(authFailed);
  assert.equal(authFailed.status, 500);
  assert.equal(authBody.error, "Failed deleting auth user.");
  assert.equal(JSON.stringify(authBody).includes("users/"), false);
  assert.equal(authSink.ops.includes("rpc:release_vibode_account_deletion_claim"), true);
  assert.equal(authSink.ops.includes("rpc:note_vibode_account_deletion_succeeded"), false);

  const okSink: OpSink = { ops: [], removed: [] };
  const okRoute = createAdminDeleteUserPostHandler({
    getAuthenticatedAdminUser: async () => ({ id: ADMIN_ID, email: "admin@example.test" }) as never,
    getServiceRoleSupabaseClient: () => createRouteSupabase(okSink) as never,
    deleteAfcV2UserStorage: async () => {
      okSink.ops.push("afc-cleanup");
      return { ok: true, deleted: 0, skipped: 0 };
    },
  });
  const ok = await post(okRoute, { userId: USER_A, confirmEmail: EMAIL_A });
  assert.equal(ok.status, 200);
  assert.equal(okSink.ops.includes("rpc:note_vibode_account_deletion_succeeded"), true);
  assert.equal(okSink.ops.includes("rpc:release_vibode_account_deletion_claim"), false);
  const beginAt = okSink.ops.indexOf("rpc:begin_vibode_account_deletion");
  const markAt = okSink.ops.indexOf("rpc:mark_vibode_account_deletion_destructive");
  const cleanupAt = okSink.ops.indexOf("afc-cleanup");
  assert.ok(beginAt >= 0 && beginAt < markAt && markAt < cleanupAt);
});

test("account deletion storage limits stay fail-closed and follow the hold check", () => {
  const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const holdAt = source.indexOf("readUnsettledGenerationHold");
  const beginAt = source.indexOf("await beginAccountDeletion");
  const markAt = source.indexOf("await markAccountDeletionDestructive");
  const cleanupAt = source.indexOf("cleanupAfcV2Storage({");
  const removeAt = source.indexOf("supabaseAdmin.storage.from(candidate.bucket).remove");
  const authDeleteAt = source.indexOf("auth.admin.deleteUser");
  const releaseAt = source.indexOf("await releaseAccountDeletionClaim");
  assert.ok(holdAt > 0);
  assert.ok(beginAt > holdAt);
  assert.ok(markAt > beginAt);
  assert.ok(cleanupAt > markAt);
  assert.ok(removeAt > cleanupAt);
  assert.ok(authDeleteAt > removeAt);
  assert.ok(releaseAt > authDeleteAt);
  assert.equal(source.match(/maxFiles: 10000/g)?.length, 2);
  assert.equal(source.match(/maxDirectories: 10000/g)?.length, 2);
  assert.match(source, /vibode-furniture-assets/);
  assert.match(source, /GENERATION_INPUT_BUCKET/);
  assert.match(source, /Generation input cleanup is incomplete/);
  assert.match(source, /Furniture storage cleanup is incomplete/);
  assert.doesNotMatch(source, /api\.meshy\.ai|MESHY_API_KEY/);
});
