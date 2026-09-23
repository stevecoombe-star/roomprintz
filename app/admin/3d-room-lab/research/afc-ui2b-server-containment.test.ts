import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const research = path.resolve(process.cwd(), "app/admin/3d-room-lab/research");
async function source(name: string) { return readFile(path.join(research, name), "utf8"); }

test("UI2B server authority remains isolated to controlled-run and strict replay modules", async () => {
  const [run, inventory, replay] = await Promise.all([
    source("afc-ui2b-proposal-run.ts"),
    source("afc-ui2b-proposal-run-inventory.ts"),
    source("afc-ui2b-binding-replay.ts"),
  ]);
  for (const value of [run, inventory, replay]) assert.equal(value.includes('import "server-only";'), true);
  assert.equal(run.includes('from "./gemini-floor-proposal-runner"'), true);
  assert.equal(inventory.includes('from "./afc-ui2b-binding-replay"'), true);
  assert.equal(inventory.includes("parseAfcUi2bBindingReceipt"), false);
  assert.equal(inventory.includes('import type { replayAfcUi2aPreparedPackage }'), true);
  assert.equal(inventory.includes('import type { replayAfcProposalOverlay }'), true);
  assert.equal(inventory.includes("gemini-floor-proposal-runner"), false);
  assert.equal(replay.includes("gemini-floor-proposal-runner"), false);
  assert.equal(inventory.includes("writeAfcR3cImmutableCapture"), false);
  for (const value of [run, inventory, replay]) {
    for (const forbidden of ["parallel_union", "runAfcR2: true", "callCompositor", "empty-room-assist/run", "GEMINI_API_KEY", "writeFile", "unlink", "rename"]) {
      assert.equal(value.includes(forbidden), false, forbidden);
    }
  }
});
