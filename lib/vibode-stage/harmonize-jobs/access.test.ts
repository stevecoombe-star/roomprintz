import assert from "node:assert/strict";
import test from "node:test";

import {
  harmonizeActorDecision,
  harmonizeMode,
  harmonizeShopperEligible,
  harmonizeShopperUserIds,
} from "./access";

const TESTER = "88888888-8888-4888-8888-888888888888";
const STRANGER = "99999999-9999-4999-8999-999999999999";

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

test("unset, empty, off, on, and unknown intake modes stay off", () => {
  for (const requested of [undefined, "", "   ", "off", "on", "ON", "beta", "true", "1"]) {
    assert.equal(harmonizeMode(env({ VIBODE_HARMONIZE_MODE: requested })), "off");
  }
  assert.equal(harmonizeMode(env({})), "off");
});

test("admin, shopper, and public modes are explicit", () => {
  assert.equal(harmonizeMode(env({ VIBODE_HARMONIZE_MODE: " admin " })), "admin");
  assert.equal(harmonizeMode(env({ VIBODE_HARMONIZE_MODE: "SHOPPER" })), "shopper");
  assert.equal(harmonizeMode(env({ VIBODE_HARMONIZE_MODE: " public " })), "public");
});

test("the shopper allowlist ignores blank and invalid ids and admits nobody when empty", () => {
  assert.equal(harmonizeShopperUserIds(env({})).size, 0);
  assert.equal(harmonizeShopperEligible(TESTER, env({})), false);
  const ids = harmonizeShopperUserIds(env({
    VIBODE_HARMONIZE_SHOPPER_USER_IDS: ` , not-a-user, ${TESTER.toUpperCase()} `,
  }));
  assert.deepEqual([...ids], [TESTER]);
  assert.equal(harmonizeShopperEligible(TESTER, env({
    VIBODE_HARMONIZE_SHOPPER_USER_IDS: TESTER,
  })), true);
  assert.equal(harmonizeShopperEligible(STRANGER, env({
    VIBODE_HARMONIZE_SHOPPER_USER_IDS: TESTER,
  })), false);
});

test("admin mode requires the admin identity and shopper mode requires eligibility", () => {
  const previous = process.env.VIBODE_ADMIN_EMAIL;
  process.env.VIBODE_ADMIN_EMAIL = "admin@example.com";
  try {
    assert.equal(harmonizeActorDecision({
      mode: "off",
      userId: TESTER,
      email: "admin@example.com",
      shopperEligible: true,
    }), "disabled");
    assert.equal(harmonizeActorDecision({
      mode: "admin",
      userId: null,
      email: null,
    }), "unauthenticated");
    assert.equal(harmonizeActorDecision({
      mode: "admin",
      userId: STRANGER,
      email: "person@example.com",
    }), "forbidden");
    assert.equal(harmonizeActorDecision({
      mode: "admin",
      userId: TESTER,
      email: "admin@example.com",
    }), "ok");
    assert.equal(harmonizeActorDecision({
      mode: "shopper",
      userId: null,
      email: null,
      shopperEligible: true,
    }), "unauthenticated");
    assert.equal(harmonizeActorDecision({
      mode: "shopper",
      userId: STRANGER,
      email: "person@example.com",
      shopperEligible: false,
    }), "forbidden");
    assert.equal(harmonizeActorDecision({
      mode: "shopper",
      userId: TESTER,
      email: "admin@example.com",
      shopperEligible: false,
    }), "forbidden");
    assert.equal(harmonizeActorDecision({
      mode: "shopper",
      userId: TESTER,
      email: "tester@example.com",
      shopperEligible: true,
    }), "ok");
    assert.equal(harmonizeActorDecision({
      mode: "public",
      userId: null,
      email: null,
      shopperEligible: true,
    }), "unauthenticated");
    assert.equal(harmonizeActorDecision({
      mode: "public",
      userId: STRANGER,
      email: "new-user@example.com",
      shopperEligible: false,
    }), "ok");
    assert.equal(harmonizeActorDecision({
      mode: "public",
      userId: TESTER,
      email: "admin@example.com",
      shopperEligible: false,
    }), "ok");
  } finally {
    if (previous === undefined) delete process.env.VIBODE_ADMIN_EMAIL;
    else process.env.VIBODE_ADMIN_EMAIL = previous;
  }
});
