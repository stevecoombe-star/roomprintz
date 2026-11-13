import assert from "node:assert/strict";
import test from "node:test";

import { createAdminAccountDeletionPostHandler } from "./route";

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_A = "22222222-2222-4222-8222-222222222222";
const EMAIL_A = "user-a@example.test";
const ATTEMPT = "99999999-9999-4999-8999-999999999999";
const STALE = "88888888-8888-4888-8888-888888888888";

function handler(input: { code?: string; errorMessage?: string; seen?: { attemptId?: string; name?: string } }) {
  return createAdminAccountDeletionPostHandler({
    getAuthenticatedAdminUser: async () => ({ id: ADMIN_ID, email: "admin@example.test" }) as never,
    getServiceRoleSupabaseClient: () => ({
      auth: {
        admin: {
          async getUserById(userId: string) {
            if (userId !== USER_A) return { data: { user: null }, error: { message: "missing" } };
            return { data: { user: { id: USER_A, email: EMAIL_A } }, error: null };
          },
        },
      },
      async rpc(name: string, args: { p_attempt_id?: string }) {
        if (input.seen) {
          input.seen.name = name;
          input.seen.attemptId = args.p_attempt_id;
        }
        if (input.errorMessage) {
          return { data: null, error: { message: input.errorMessage, code: "XX000" } };
        }
        if (input.code === "ok") return { data: { ok: true }, error: null };
        return { data: { ok: false, code: input.code }, error: null };
      },
    }) as never,
  });
}

async function post(
  action: "abandon" | "resume",
  attemptId: string,
  input: { code?: string; errorMessage?: string; seen?: { attemptId?: string; name?: string } },
) {
  const response = await handler(input)(new Request("http://test/api/admin/account-deletion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: USER_A,
      confirmEmail: EMAIL_A,
      attemptId,
      action,
    }),
  }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

test("account deletion recovery stays admin-only and attempt-scoped", async () => {
  const denied = await createAdminAccountDeletionPostHandler({
    getAuthenticatedAdminUser: async () => null,
    getServiceRoleSupabaseClient: () => {
      throw new Error("client should not be used");
    },
  })(new Request("http://test/api/admin/account-deletion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: USER_A, confirmEmail: EMAIL_A, attemptId: ATTEMPT, action: "abandon" }),
  }));
  assert.equal(denied.status, 403);

  const abandoned = await post("abandon", ATTEMPT, { code: "ok" });
  assert.equal(abandoned.status, 200);
  assert.equal(abandoned.body.ok, true);
  assert.equal(abandoned.body.action, "abandon");

  const resumed = await post("resume", ATTEMPT, { code: "ok" });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.action, "resume");

  const seen: { attemptId?: string; name?: string } = {};
  const stale = await post("abandon", STALE, { code: "attempt_mismatch", seen });
  assert.equal(seen.attemptId, STALE);
  assert.equal(seen.name, "abandon_vibode_account_deletion");
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "This deletion attempt is no longer current.");
  assert.equal(JSON.stringify(stale.body).includes("users/"), false);

  const started = await post("abandon", ATTEMPT, { code: "cleanup_started" });
  assert.equal(started.status, 409);
  assert.match(String(started.body.error), /Retry account deletion/);

  const running = await post("abandon", ATTEMPT, { code: "deletion_in_progress" });
  assert.equal(running.status, 409);

  const secret = await post("resume", ATTEMPT, { errorMessage: "users/secret/model.glb" });
  assert.equal(secret.status, 500);
  assert.equal(secret.body.error, "Account deletion could not be updated.");
  assert.equal(JSON.stringify(secret.body).includes("users/"), false);
  assert.equal(JSON.stringify(secret.body).includes("model.glb"), false);
});
