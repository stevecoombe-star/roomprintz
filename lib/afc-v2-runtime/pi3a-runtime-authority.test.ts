import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { isAfcV2ProductionRoomAuthority } from "@/lib/afc-v2-production/production-authority-contract";

import { validateProductionRuntimeAuthority } from "./runtime-authority";
import { createPi3aAuthority } from "./pi3a-test-fixture";

const ROOT = process.cwd();

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("runtime consumes compact production authority and refuses incompatible payloads", () => {
  const authority = createPi3aAuthority();
  assert.equal(isAfcV2ProductionRoomAuthority(authority), true);
  const validated = validateProductionRuntimeAuthority(authority);
  if (!validated.ok) throw new Error(validated.reason);
  assert.equal(validated.authority.generationId, authority.generationId);
  assert.equal(validated.authority.schemaVersion, "afc-v2-production-room-authority/v1");

  const rejected = validateProductionRuntimeAuthority({
    ...authority,
    schemaVersion: "afc-v2-production-room-authority/v0",
  });
  assert.equal(rejected.ok, false);
});

test("production runtime modules do not invoke AFC analysis or providers", () => {
  const runtimeFiles = walk(path.join(ROOT, "lib/afc-v2-runtime"));
  const componentFiles = walk(path.join(ROOT, "components/afc-3d"));
  const route = source("app/api/vibode/afc/runtime/route.ts");
  const joined = [...runtimeFiles, ...componentFiles]
    .filter((file) => !file.endsWith(".test.ts") && !file.endsWith("pi3a-test-fixture.ts"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n") + `\n${route}`;

  assert.doesNotMatch(joined, /executeAfcV2Analysis/);
  assert.doesNotMatch(joined, /runProductionAfcAnalysis/);
  assert.doesNotMatch(joined, /observeRoom|generateTiled|readTiledPerspective/);
  assert.match(route, /restoreProductionAfcRoom/);
  assert.doesNotMatch(route, /executeAfcV2Analysis/);
});
