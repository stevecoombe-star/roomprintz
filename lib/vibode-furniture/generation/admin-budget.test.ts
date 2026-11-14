import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_BUDGET_BOUNDS,
  ADMIN_BUDGET_CONFIRM,
  ADMIN_BUDGET_STEP,
  ADMIN_BUDGET_UNAUTHORIZED,
  budgetLimitsCoverObligations,
  furnitureGenerationBudgetHistoryResponse,
  furnitureGenerationBudgetResponse,
  parseBudgetAdjustment,
  parseBudgetHistory,
} from "@/lib/vibode-furniture/generation/admin-budget";

const ADMIN = { id: "55555555-5555-4555-8555-555555555555" };

test("a confirmed administrator budget change keeps the historical consumption", async () => {
  const response = await furnitureGenerationBudgetResponse({
    getAdmin: async () => ADMIN,
    adjust: async (args) => {
      assert.equal(args.p_credit_ceiling, 300);
      assert.equal(args.p_paid_submissions_authorized, 10);
      assert.equal(args.p_live_enabled, false);
      assert.equal(args.p_confirmed, true);
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
    creditCeiling: 1_000_000_001,
    paidSubmissionsAuthorized: 10,
    liveEnabled: false,
    reason: "Above the infrastructure boundary",
    confirmed: true,
  }));
  assert.equal(oversized.status, 400);
  assert.equal(oversized.body.error, ADMIN_BUDGET_BOUNDS);

  const stepped = await furnitureGenerationBudgetResponse({
    getAdmin: async () => ADMIN,
    adjust: async () => ({ data: { ok: false, code: "budget_step" }, error: null }),
  }, request({
    creditCeiling: 20_000,
    paidSubmissionsAuthorized: 10,
    liveEnabled: false,
    reason: "The database rejects an oversized single step",
    confirmed: true,
  }));
  assert.equal(stepped.status, 400);
  assert.equal(stepped.body.error, ADMIN_BUDGET_STEP);

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

test("admission can turn off without raising a ceiling that settlement already exceeded", async () => {
  assert.equal(budgetLimitsCoverObligations({
    creditCeiling: 120,
    paidSubmissionsAuthorized: 4,
    currentCeiling: 120,
    currentPaidSubmissionsAuthorized: 4,
    creditsConsumed: 95,
    creditsReserved: 30,
    paidSubmissionsUsed: 2,
  }), true);
  assert.equal(budgetLimitsCoverObligations({
    creditCeiling: 124,
    paidSubmissionsAuthorized: 4,
    currentCeiling: 120,
    currentPaidSubmissionsAuthorized: 4,
    creditsConsumed: 95,
    creditsReserved: 30,
    paidSubmissionsUsed: 2,
  }), false);

  const response = await furnitureGenerationBudgetResponse({
    getAdmin: async () => ADMIN,
    adjust: async (args) => {
      assert.equal(args.p_credit_ceiling, 120);
      assert.equal(args.p_paid_submissions_authorized, 4);
      assert.equal(args.p_live_enabled, false);
      assert.equal(args.p_confirmed, true);
      return {
        data: {
          ok: true,
          unchanged: false,
          live_enabled: false,
          credit_ceiling: 120,
          paid_submissions_authorized: 4,
          credits_consumed: 95,
          credits_reserved: 30,
          paid_submissions_used: 2,
        },
        error: null,
      };
    },
  }, request({
    creditCeiling: 120,
    paidSubmissionsAuthorized: 4,
    liveEnabled: false,
    reason: "Turn admission off while settlement exceeds the ceiling",
    confirmed: true,
  }));
  assert.equal(response.status, 200);
  assert.equal(parseBudgetAdjustment(response.body)?.liveEnabled, false);
  assert.equal(parseBudgetAdjustment(response.body)?.creditCeiling, 120);
  assert.equal(parseBudgetAdjustment(response.body)?.creditsConsumed, 95);
});

test("budget history keeps the administrator, the reason, and the previous values", async () => {
  const response = await furnitureGenerationBudgetHistoryResponse({
    getAdmin: async () => ADMIN,
    read: async () => ({
      data: {
        ok: true,
        events: [{
          event_id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
          actor_user_id: ADMIN.id,
          reason: "Owner approved the operating budget",
          live_enabled_before: false,
          live_enabled_after: false,
          credit_ceiling_before: 60,
          credit_ceiling_after: 300,
          paid_submissions_authorized_before: 2,
          paid_submissions_authorized_after: 10,
          credits_consumed: 60,
          credits_reserved: 0,
          paid_submissions_used: 2,
          created_at: "2026-11-14T20:00:00.000Z",
        }],
      },
      error: null,
    }),
  });
  assert.equal(response.status, 200);
  const events = parseBudgetHistory(response.body);
  assert.equal(events?.length, 1);
  assert.equal(events?.[0]?.reason, "Owner approved the operating budget");
  assert.equal(events?.[0]?.creditCeilingBefore, 60);
  assert.equal(events?.[0]?.creditsConsumed, 60);
  assert.equal(events?.[0]?.paidSubmissionsUsed, 2);

  const hidden = await furnitureGenerationBudgetHistoryResponse({
    getAdmin: async () => null,
    read: async () => {
      throw new Error("unexpected");
    },
  });
  assert.equal(hidden.status, 403);
});

function request(body: unknown): Request {
  return new Request("https://www.vibode.com/api/admin/furniture-generation/budget", {
    method: "POST",
    headers: { origin: "https://www.vibode.com", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
