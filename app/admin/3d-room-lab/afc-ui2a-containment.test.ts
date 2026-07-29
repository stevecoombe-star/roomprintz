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
test("UI2A Empty resolution is the sole fixed-capture capability importer", async () => {
  const research = [
    "research/afc-ui2a-package-contract.ts",
    "research/afc-ui2a-original-preparation-replay.ts",
    "research/afc-ui2a-empty-evidence-replay.ts",
    "research/afc-ui2a-empty-resolution.ts",
  ];
  const fixedCaptureImports = await Promise.all(research.map(async (file) => ({
    file,
    text: await source(file),
  })));
  assert.deepEqual(
    fixedCaptureImports.filter(({ text }) => text.includes('from "./afc-r3c-fixed-empty-room-capture"')).map(({ file }) => file),
    ["research/afc-ui2a-empty-resolution.ts"]
  );
  for (const { text } of fixedCaptureImports) {
    for (const forbidden of ["@/lib/vibodeEmptyRoomAssist", "@/lib/callCompositorVibodeStageRun", "gemini-floor-proposal-provider", "gemini-floor-proposal-runner", "afc-r3c-manifest", "shared-comparison-context", "token-accounting"]) {
      assert.equal(text.includes(forbidden), false, forbidden);
    }
  }
});

test("UI2A prepared-package modules are server-only and capability-contained", async () => {
  const files = [
    "research/afc-ui2a-shared-context.ts",
    "research/afc-ui2a-package-image-verification.ts",
    "research/afc-ui2a-manifest-writer.ts",
    "research/afc-ui2a-prepared-package-contract.ts",
    "research/afc-ui2a-prepared-package.ts",
    "research/afc-ui2a-prepared-package-replay.ts",
  ];
  const texts = await Promise.all(files.map(source));
  for (const text of texts) {
    assert.equal(text.includes('import "server-only"'), true);
    for (const forbidden of [
      "afc-r3c-fixed-empty-room-capture", "vibodeEmptyRoomAssist", "callCompositorVibodeStageRun",
      "gemini-floor-proposal-provider", "gemini-floor-proposal-runner", "candidate-discrimination-harness",
      "scene-state", "setFloor", "setCamera", "setSupport", "supabase", "token-accounting",
      "vibodeAfcUi2aConfig", "vibodeEmptyRoomAssist",
    ]) assert.equal(text.includes(forbidden), false, forbidden);
  }
  const compositionImports = texts.flatMap((text) => [...text.matchAll(/from "\.\/gemini-floor-proposal-composition"/g)].map(() => text));
  assert.equal(compositionImports.length, 2);
  for (const text of compositionImports) assert.equal(text.includes("classifyAfcR3cImagePairCompatibility"), true);
  const replay = texts.at(-1) ?? "";
  for (const forbidden of ["writeAfcR3cImmutableCapture", "writeFile", "mkdir", "open("]) assert.equal(replay.includes(forbidden), false, forbidden);
  const materializer = texts.at(-2) ?? "";
  assert.equal(materializer.includes("writeAfcR3cImmutableCapture"), true);
  assert.equal(materializer.includes("resolutionSource"), false);
  assert.equal(materializer.includes("captureSource"), false);
  assert.equal(materializer.includes("requestId"), false);
});
