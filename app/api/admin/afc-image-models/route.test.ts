import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

test("admin AFC image model route is authenticated and secret-free", () => {
  const route = readFileSync(
    path.join(ROOT, "app/api/admin/afc-image-models/route.ts"),
    "utf8",
  );
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /getAuthenticatedAdminUser/);
  assert.match(route, /Admin access required/);
  assert.match(route, /Unknown AFC image model/);
  assert.doesNotMatch(route, /OPENAI_API_KEY|NEXT_PUBLIC_|Authorization|apiKey/);
});

test("AFC diagnostics hosts independent EMPTY and TILED model selectors", () => {
  const settings = readFileSync(
    path.join(ROOT, "app/admin/afc-diagnostics/AfcImageModelSettings.tsx"),
    "utf8",
  );
  const inbox = readFileSync(
    path.join(ROOT, "app/admin/afc-diagnostics/AfcDiagnosticCaseInbox.tsx"),
    "utf8",
  );
  const adminHome = readFileSync(path.join(ROOT, "app/admin/AdminControls.tsx"), "utf8");
  assert.match(inbox, /<AfcImageModelSettings/);
  assert.match(settings, /AFC Image Models/);
  assert.match(settings, /aria-label="AFC EMPTY image model"/);
  assert.match(settings, /aria-label="AFC TILED image model"/);
  assert.match(settings, /AFC_IMAGE_MODEL_OPTION_LIST/);
  assert.match(settings, /\/api\/admin\/afc-image-models/);
  assert.doesNotMatch(settings, /Nano Banana 2|localStorage|OPENAI_API_KEY/);
  assert.doesNotMatch(adminHome, /AFC Image Models|AfcImageModelSettings|afc-image-models/);
});
