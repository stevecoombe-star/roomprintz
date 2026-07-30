import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd(), "app/admin/3d-room-lab");
async function source(relative: string) {
  return readFile(path.join(root, relative), "utf8");
}
test("UI2A client boundary has no scene, persistence, upload, or live capability", async () => {
  const text = `${await source("AfcUi2aRunnerPanel.tsx")}\n${await source("afc-ui2a-runner-state.ts")}`;
  for (const forbidden of ["setFloor", "setCamera", "setSupport", "SceneJson", "localStorage", "sessionStorage", "indexedDB", "gemini-floor-proposal", "AFC-R2", "callCompositorVibodeStageRun", "token-accounting", "outputDir", "type=\"file\"", "resolvedModelId"]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test("UI2A complete and inventory services keep package authority server-only", async () => {
  const [complete, inventory, completeRoute, packagesRoute] = await Promise.all([
    source("research/afc-ui2a-complete.ts"),
    source("research/afc-ui2a-package-inventory.ts"),
    readFile(path.resolve(process.cwd(), "app/api/admin/3d-room-lab/afc-ui2a/complete/route.ts"), "utf8"),
    readFile(path.resolve(process.cwd(), "app/api/admin/3d-room-lab/afc-ui2a/packages/route.ts"), "utf8"),
  ]);
  assert.equal(complete.includes('import "server-only"'), true);
  assert.equal(inventory.includes('import "server-only"'), true);
  assert.equal(complete.includes('from "./afc-ui2a-empty-resolution"'), true);
  for (const forbidden of ["afc-r3c-fixed-empty-room-capture", "callCompositorVibodeStageRun", "writeAfcR3cImmutableCapture"]) assert.equal(completeRoute.includes(forbidden), false, forbidden);
  for (const forbidden of ["writeFile", "mkdir", "open(", "writeAfcR3cImmutableCapture", "delete", "unlink"]) assert.equal(inventory.includes(forbidden), false, forbidden);
  assert.equal(inventory.includes('replayAfcUi2aPreparedPackage'), true);
  assert.equal(packagesRoute.includes("afc-ui2a-package-inventory"), true);
  assert.equal(packagesRoute.includes("afc-ui2a-prepared-package"), false);
});

test("UI2A-2C contracts, routes, and panel keep explicit capability boundaries", async () => {
  const files = {
    completeContract: "research/afc-ui2a-complete-contract.ts",
    complete: "research/afc-ui2a-complete.ts",
    inventory: "research/afc-ui2a-package-inventory.ts",
    panel: "AfcUi2aRunnerPanel.tsx",
    state: "afc-ui2a-runner-state.ts",
  } as const;
  const text = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await source(file)]))) as Record<keyof typeof files, string>;
  const routeRoot = path.resolve(process.cwd(), "app/api/admin/3d-room-lab/afc-ui2a");
  const [completeRoute, packagesRoute, routeNames] = await Promise.all([
    readFile(path.join(routeRoot, "complete/route.ts"), "utf8"),
    readFile(path.join(routeRoot, "packages/route.ts"), "utf8"),
    readdir(routeRoot),
  ]);
  assert.deepEqual(routeNames.filter((name) => !name.startsWith(".")).sort(), ["complete", "packages", "prepare", "status"]);
  assert.equal(text.completeContract.includes("roomDirectory"), false);
  assert.equal(text.completeContract.includes("originalFilePath"), false);
  assert.equal(text.completeContract.includes("resolvedModelId"), false);
  assert.equal(text.complete.includes('import "server-only"'), true);
  assert.equal(text.inventory.includes('import "server-only"'), true);
  assert.equal(text.complete.includes('from "./afc-ui2a-empty-resolution"'), true);
  assert.equal(text.inventory.includes('from "./afc-ui2a-prepared-package-replay"'), true);
  for (const forbidden of [
    "compatibility: { ...materialized.compatibility }",
    "manifest: { ...materialized.manifest }",
    "receipt: { ...materialized.receipt }",
    "safety: { ...materialized.safety }",
    "original: { ...receipt.original }",
    "compatibility: { ...receipt.compatibility }",
    "safety: { ...receipt.safety }",
  ]) assert.equal(`${text.complete}\n${text.inventory}`.includes(forbidden), false, forbidden);
  for (const forbidden of ["writeFile", "mkdir", "open(", "unlink", "rm("]) assert.equal(text.inventory.includes(forbidden), false, forbidden);
  for (const forbidden of ["afc-ui2a-empty-resolution", "afc-ui2a-prepared-package", "afc-r3c-fixed-empty-room-capture", "callCompositorVibodeStageRun"]) assert.equal(completeRoute.includes(forbidden), false, forbidden);
  for (const forbidden of ["afc-ui2a-prepared-package", "writeAfcR3cImmutableCapture", "callCompositorVibodeStageRun"]) assert.equal(packagesRoute.includes(forbidden), false, forbidden);
  for (const client of [text.panel, text.state]) {
    for (const forbidden of ["research/", "AFC_UI2A_EMPTY_GENERATION_ENABLED", "AFC_UI1_FIXED_INPUTS_ROOT", "resolvedModelId", "localStorage", "sessionStorage", "indexedDB"]) assert.equal(client.includes(forbidden), false, forbidden);
  }
  for (const visible of ["Prepared Input Package", "Refresh packages", "Complete prepared package", "Generate Empty Room and complete package", "This will request up to one Empty-Room compositor generation call.", "Strict package replay verified"]) {
    assert.equal(text.panel.includes(visible), true, visible);
  }
  assert.equal(text.panel.includes('state.completionStatus === "generation_required"'), true);
  assert.equal(text.state.includes("void refreshPackageInventory()"), true);
});

test("UI2A clear invalidates every request guard before exposing reset state", async () => {
  const [state, panel] = await Promise.all([source("afc-ui2a-runner-state.ts"), source("AfcUi2aRunnerPanel.tsx")]);
  const clear = state.match(/const clear = useCallback\(\(\) => \{([\s\S]*?)setOperationIdentity/);
  assert.ok(clear);
  const body = clear[1];
  for (const invalidation of [
    "prepareGeneration.current.invalidate()",
    "statusGeneration.current.invalidate()",
    "packageGeneration.current.invalidate()",
    "completionGeneration.current.invalidate()",
  ]) assert.equal(body.includes(invalidation), true, invalidation);
  assert.equal(panel.includes('disabled={state.status === "preparing" || state.requestGenerationInFlight}'), true);
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
