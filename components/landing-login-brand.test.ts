import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("landing and login adopt the retail palette without changing other auth surfaces", () => {
  const landing = source("app/page.tsx");
  const login = source("app/login/LoginInner.tsx");
  const panel = source("components/AuthPanel.tsx");
  const banner = source("components/LatestFurnitureCollectionImportBanner.tsx");
  const account = source("app/app/page.tsx");
  const profile = source("app/app/profile/page.tsx");
  const editor = source("app/editor/page.tsx");

  assert.match(landing, /scheme-light min-h-screen bg-canvas text-ink/);
  assert.match(landing, /See it in your room before you buy\./);
  assert.match(landing, /variant="primary" size="large"/);
  assert.match(landing, /Log in \/ Create account/);
  assert.match(landing, /appearance="retail"/);
  assert.match(landing, /scrollIntoView/);
  assert.doesNotMatch(landing, /emerald-|slate-950|#[0-9A-Fa-f]{3,8}\b/);

  assert.match(login, /scheme-light min-h-screen bg-canvas text-ink/);
  assert.match(login, /sanitizeNextPath/);
  assert.match(login, /<AuthPanel appearance="retail" \/>/);
  assert.match(login, /Redirect after login:/);
  assert.doesNotMatch(login, /emerald-|slate-950|router\.replace\([^n]/);

  assert.match(panel, /appearance = "default"/);
  assert.match(panel, /bg-slate-900 border border-slate-800/);
  assert.match(panel, /bg-emerald-500 hover:bg-emerald-400/);
  assert.match(panel, /signInWithPassword/);
  assert.match(panel, /supabase\.auth\.signUp/);
  assert.match(panel, /type="password"/);
  assert.match(panel, /variant="primary" size="compact"/);
  assert.match(panel, /text-danger/);
  assert.doesNotMatch(panel, /#[0-9A-Fa-f]{3,8}\b/);

  assert.match(banner, /appearance = "default"/);
  assert.match(banner, /border-emerald-500\/40 bg-emerald-500\/10/);
  assert.match(banner, /href="#auth-panel"/);
  assert.match(banner, /appearance === "retail"/);

  assert.match(account, /<AuthPanel \/>/);
  assert.doesNotMatch(account, /appearance="retail"|VibodeButton/);
  assert.match(profile, /<AuthPanel \/>/);
  assert.doesNotMatch(profile, /appearance="retail"|VibodeButton/);
  assert.match(editor, /<LatestFurnitureCollectionImportBanner \/>/);
  assert.doesNotMatch(editor, /appearance="retail"|VibodeButton/);
});
