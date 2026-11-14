import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_BUDGET_BOUNDS,
  ADMIN_BUDGET_CONFIRM,
  ADMIN_BUDGET_UNAUTHORIZED,
  furnitureGenerationBudgetResponse,
  parseBudgetAdjustment,
} from "@/lib/vibode-furniture/generation/admin-budget";

const ADMIN = { id: "55555555-5555-4555-8555-555555555555" };

test("a confirmed administrator budget change keeps the historical consumption", async () => {
  const response = await furnitureGenerationBudgetResponse({
    getAdmin: async () => ADMIN,
    adjust: async (args) => {
      assert.equal(args.p_credit_ceiling, 300);
      assert.equal(args.p_paid_submissions_authorized, 10);
      assert.equal(args.p_live_enabled, false);
      return {
        data: {
          ok: true,
          unchanged: false,
          live_enabled: false,
          credit_ceiling: 300,
          paid_submissions_authorized: 10,
          credits_consumed: 60,
          credits_reserved: 0,
          paid_submissions_used: 2,
        },
        error: null,
      };
    },
  }, request({
    creditCeiling: 300,
    paidSubmissionsAuthorized: 10,
    liveEnabled: false,
    reason: "Owner approved eight more generations",
    confirmed: true,
  }));
  assert.equal(response.status, 200);
  const parsed = parseBudgetAdjustment(response.body);
  assert.equal(parsed?.creditsConsumed, 60);
  assert.equal(parsed?.paidSubmissionsUsed, 2);
  assert.equal(parsed?.creditCeiling, 300);
});

test("budget changes fail closed without confirmation, authority, or a bounded value", async () => {
  const unconfirmed = await furnitureGenerationBudgetResponse({
    getAdmin: async () => ADMIN,
    adjust: async () => {
      throw new Error("unexpected");
    },
  }, request({
    creditCeiling: 300,
    paidSubmissionsAuthorized: 10,
    liveEnabled: false,
    reason: "Missing confirmation",
    confirmed: false,
  }));
  assert.equal(unconfirmed.status, 400);
  assert.equal(unconfirmed.body.error, ADMIN_BUDGET_CONFIRM);

  const oversized = await furnitureGenerationBudgetResponse({
    getAdmin: async () => ADMIN,
    adjust: async () => {
      throw new Error("unexpected");
    },
  }, request({
    creditCeiling: 601,
    paidSubmissionsAuthorized: 10,
    liveEnabled: false,
    reason: "Above the hard rail",
    confirmed: true,
  }));
  assert.equal(oversized.status, 400);
  assert.equal(oversized.body.error, ADMIN_BUDGET_BOUNDS);

  const unauthorized = await furnitureGenerationBudgetResponse({
    getAdmin: async () => ADMIN,
    adjust: async () => ({ data: { ok: false, code: "budget_unauthorized" }, error: null }),
  }, request({
    creditCeiling: 300,
    paidSubmissionsAuthorized: 10,
    liveEnabled: false,
    reason: "The database has no administrator email",
    confirmed: true,
  }));
  assert.equal(unauthorized.status, 403);
  assert.equal(unauthorized.body.error, ADMIN_BUDGET_UNAUTHORIZED);
});

function request(body: unknown): Request {
  return new Request("https://www.vibode.com/api/admin/furniture-generation/budget", {
    method: "POST",
    headers: { origin: "https://www.vibode.com", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
