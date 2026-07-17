import { resolveSupabaseSecretKey } from "./supabase-secret-key.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`,
    );
  }
}

function assertThrows(callback: () => unknown, expectedMessage: string) {
  try {
    callback();
  } catch (error) {
    if (error instanceof Error && error.message.includes(expectedMessage)) {
      return;
    }
    throw error;
  }
  throw new Error("Expected callback to throw.");
}

Deno.test("resolves the vibode_ui_production named secret key", () => {
  const secretKey = resolveSupabaseSecretKey(
    JSON.stringify({
      vibode_ui_production: "sb_secret_test_key",
      another_key: "unused",
    }),
  );

  assertEquals(secretKey, "sb_secret_test_key");
});

Deno.test("rejects a missing SUPABASE_SECRET_KEYS variable", () => {
  assertThrows(
    () => resolveSupabaseSecretKey(undefined),
    "Missing required SUPABASE_SECRET_KEYS",
  );
});

Deno.test("rejects malformed SUPABASE_SECRET_KEYS JSON", () => {
  assertThrows(
    () => resolveSupabaseSecretKey("{not-json"),
    "must contain valid JSON",
  );
});

Deno.test("rejects non-object SUPABASE_SECRET_KEYS JSON", () => {
  for (const value of ["null", "[]", '"not-an-object"']) {
    assertThrows(
      () => resolveSupabaseSecretKey(value),
      "must be a JSON object",
    );
  }
});

Deno.test("rejects a missing vibode_ui_production named key", () => {
  assertThrows(
    () => resolveSupabaseSecretKey(JSON.stringify({ another_key: "unused" })),
    'named "vibode_ui_production"',
  );
});

Deno.test("rejects non-string and empty vibode_ui_production named keys", () => {
  for (const value of [null, 1, "", "   "]) {
    assertThrows(
      () =>
        resolveSupabaseSecretKey(
          JSON.stringify({ vibode_ui_production: value }),
        ),
      'named "vibode_ui_production"',
    );
  }
});
