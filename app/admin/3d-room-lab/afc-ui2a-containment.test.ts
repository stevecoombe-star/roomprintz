import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd(), "app/admin/3d-room-lab");
async function source(relative: string) {
  return readFile(path.join(root, relative), "utf8");
}
test("UI2A client boundary has no scene, persistence, upload, or live capability", async () => {
  const text = `${await source("AfcUi2aRunnerPanel.tsx")}\n${await source("afc-ui2a-runner-state.ts")}`;
  for (const forbidden of ["setFloor", "setCamera", "setSupport", "SceneJson", "localStorage", "sessionStorage", "indexedDB", "gemini-floor-proposal", "AFC-R2", "compositor", "token-accounting", "outputDir", "type=\"file\""]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});
test("UI2A server preparation and status stay capability-contained", async () => {
  const preparation = await source("research/afc-ui2a-prepare-original.ts");
  const status = await source("research/afc-ui2a-status.ts");
  for (const forbidden of ["from \"./gemini-floor-proposal-runner\"", "from \"./gemini-floor-proposal-provider\"", "from \"@/lib/vibodeEmptyRoomAssist\"", "from \"@/app/admin/3d-room-lab/scene-state\""]) assert.equal(preparation.includes(forbidden), false, forbidden);
  for (const forbidden of ["writeFile", "mkdir", "open(", "writeAfcR3cImmutableCapture", "gemini-floor-proposal"]) assert.equal(status.includes(forbidden), false, forbidden);
});
