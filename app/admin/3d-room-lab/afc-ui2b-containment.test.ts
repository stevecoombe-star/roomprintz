import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd(), "app/admin/3d-room-lab");
async function source(file: string) { return readFile(path.join(root, file), "utf8"); }

test("UI2B client and routes retain strict capability boundaries", async () => {
  const [panel, state, runRoute, runsRoute] = await Promise.all([
    source("AfcUi2bProposalRunnerPanel.tsx"),
    source("afc-ui2b-runner-state.ts"),
    readFile(path.resolve(process.cwd(), "app/api/admin/3d-room-lab/afc-ui2b/proposal-run/route.ts"), "utf8"),
    readFile(path.resolve(process.cwd(), "app/api/admin/3d-room-lab/afc-ui2b/proposal-runs/route.ts"), "utf8"),
  ]);
  for (const client of [panel, state]) {
    for (const forbidden of [
      "research/", "GEMINI_API_KEY", "GOOGLE_API_KEY", "AFC_UI2B_", "localStorage", "sessionStorage", "indexedDB",
      "setFloor", "setCamera", "setSupport", "SceneJson", "parallel_union", "parallel", "callCompositor", "outputDir", "node:fs",
      "apiKey", "providerEnvelope", "modelOutput", "requestId", "/Users/", ".local/",
    ]) assert.equal(client.includes(forbidden), false, forbidden);
  }
  for (const route of [runRoute, runsRoute]) {
    for (const forbidden of ["gemini-floor-proposal-provider", "gemini-floor-proposal-runner", "afc-ui2a-prepared-package-replay", "node:fs", "writeAfcR3cImmutableCapture"]) assert.equal(route.includes(forbidden), false, forbidden);
  }
  assert.equal(panel.includes("Run one Gemini Floor-proposal call"), true);
  assert.equal(panel.includes("This will make exactly one live Gemini Floor-proposal provider call"), true);
  assert.equal(panel.includes("one immutable local research receipt"), true);
  assert.equal(panel.includes("Companion receipt"), true);
  assert.equal(panel.includes('type="button"'), true);
  for (const required of ["Validate proposal run", "Select study mode…", "original_only", "empty_only", "Reveal receipt for manual viewer selection"]) {
    assert.equal(panel.includes(required), true, required);
  }
  for (const forbidden of ["Retry", "<form", "parallel_union", "AFC-R2", "Apply", "providerEnvelope", "modelOutput"]) {
    assert.equal(panel.includes(forbidden), false, forbidden);
  }
  assert.equal(panel.includes("Load proposal receipt in viewer"), false);
  assert.equal(panel.includes('enabled && state.validationStatus === "validated"'), true);
  assert.equal(panel.includes("disabled={!enabled || state.requestInFlight}"), true);
  assert.equal(state.includes("execute();"), false);
  assert.equal(state.includes("setTimeout"), false);
  assert.equal(state.includes("viewerHandoffReceipt, setViewerHandoffReceipt] = useState<string | null>(null)"), true);
  assert.equal(state.includes('selectedPackage, setSelectedPackage] = useState<AfcUi2bPackage | null>(null)'), true);
  assert.equal(state.includes('studyMode, setStudyMode] = useState<AfcUi2bStudyMode | "">("")'), true);
  for (const guard of ["packageGuard", "validationGuard", "executionGuard", "runGuard"]) {
    assert.equal(state.includes(`${guard} = useRef(createAfcUi2bRequestGuard())`), true, guard);
  }
});
test("UI2B state invalidates all guards when the feature is disabled", async () => {
  const state = await source("afc-ui2b-runner-state.ts");
  assert.equal(state.includes("if (enabled) return;"), true);
  assert.equal(state.includes("queueMicrotask(() => { if (!cancelled) clear(); });"), true);
  for (const guard of ["packageGuard", "validationGuard", "executionGuard", "runGuard"]) {
    assert.equal(state.includes(`${guard}.current.invalidate()`), true, guard);
  }
  for (const cleared of [
    'setPackages([])', 'setSelectedPackage(null)', 'setStudyMode("")', 'setLastValidation(null)', 'setLastRun(null)',
    'setViewerHandoffReceipt(null)', 'setRunInventory([])',
  ]) assert.equal(state.includes(cleared), true, cleared);
  assert.equal(state.includes("entries.length - accepted.length"), true);
  assert.equal(state.includes("const selectPackage = useCallback"), true);
  assert.equal(state.includes("const selectStudyMode = useCallback"), true);
  assert.equal((state.match(/invalidateRunState\(\);/g) ?? []).length >= 3, true);
});

test("UI2B clear, panel props, host mount, and route inventory remain structurally isolated", async () => {
  const [panel, state, host, routeEntries] = await Promise.all([
    source("AfcUi2bProposalRunnerPanel.tsx"),
    source("afc-ui2b-runner-state.ts"),
    source("ThreeRoomLab.tsx"),
    readdir(path.resolve(process.cwd(), "app/api/admin/3d-room-lab/afc-ui2b"), { withFileTypes: true }),
  ]);
  assert.equal(panel.includes("type Props = Readonly<{ enabled: boolean; open: boolean; onToggle: () => void }>;"), true);
  const mountStart = host.indexOf("<AfcUi2bProposalRunnerPanel");
  const mountEnd = host.indexOf("/>", mountStart);
  assert.notEqual(mountStart, -1);
  assert.notEqual(mountEnd, -1);
  const mount = host.slice(mountStart, mountEnd);
  for (const prop of ["enabled=", "open=", "onToggle="]) assert.equal(mount.includes(prop), true, prop);
  for (const forbidden of ["floor=", "camera=", "support=", "scene=", "currentImage=", "qualificationStatus="]) {
    assert.equal(mount.includes(forbidden), false, forbidden);
  }
  const invalidateStart = state.indexOf("const invalidateRunState = useCallback");
  const invalidateEnd = state.indexOf("useEffect(() => () =>", invalidateStart);
  const invalidateBody = state.slice(invalidateStart, invalidateEnd);
  for (const guard of ["validationGuard", "executionGuard", "runGuard"]) {
    assert.equal(invalidateBody.includes(`${guard}.current.invalidate()`), true, guard);
  }
  const clearStart = state.indexOf("const clear = useCallback");
  const clearEnd = state.indexOf("const refreshPackages = useCallback", clearStart);
  const clearBody = state.slice(clearStart, clearEnd);
  assert.equal(clearBody.includes("packageGuard.current.invalidate()"), true);
  assert.equal(clearBody.includes("invalidateRunState()"), true);
  assert.deepEqual(
    routeEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(),
    ["proposal-run", "proposal-runs"],
  );
});

test("UI2B rendered truth cards keep validation and completed-run authorities separate", () => {
  const receiptSha256 = "a".repeat(64);
  const script = `
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import panel from "./app/admin/3d-room-lab/AfcUi2bProposalRunnerPanel.tsx";
    const { AfcUi2bCompletedRunTruthCard, AfcUi2bValidationTruthCard } = panel;

    const lastValidation = {
      selectedImage: { role: "original_photo_contextual_geometry", sha256: "${"b".repeat(64)}" },
      manifest: { fileName: "room-a.manifest.json", sha256: "${"c".repeat(64)}" },
      runner: {
        promptRole: "original_photo_contextual_geometry",
        modelId: "gemini-validation",
        providerCallCount: 0,
        captureWrite: false,
      },
    };
    const lastRun = {
      runner: {
        promptRole: "original_photo_contextual_geometry",
        modelId: "gemini-execution",
        providerCallCount: 1,
        captureWrite: true,
        companionReceiptWritten: true,
      },
      proposal: {
        receiptFileName: "afc-r3c-run.room-a-r1.receipt.json",
        receiptSha256: "${receiptSha256}",
        candidateCount: 1,
        acceptedCandidateIds: ["candidate-r1"],
        warningCount: 0,
        strictReplayVerified: true,
      },
    };
    process.stdout.write(renderToStaticMarkup(
      React.createElement("div", null,
        React.createElement(AfcUi2bValidationTruthCard, { result: lastValidation }),
        React.createElement(AfcUi2bCompletedRunTruthCard, {
          result: lastRun,
          viewerHandoffReceipt: null,
          onPrepareViewerHandoff: () => undefined,
        }),
      ),
    ));
  `;
  const markup = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const validation = markup.match(/<section[^>]*data-afc-ui2b-truth="validation"[^>]*>[\s\S]*?<\/section>/)?.[0];
  const execution = markup.match(/<section[^>]*data-afc-ui2b-truth="execution"[^>]*>[\s\S]*?<\/section>/)?.[0];
  assert.ok(validation);
  assert.ok(execution);
  assert.equal(validation.includes("Provider calls / capture writes</dt><dd>0 / false"), true);
  assert.equal(validation.includes("1 / true"), false);
  assert.equal(execution.includes("Provider calls / capture write</dt><dd>1 / true"), true);
  assert.equal(execution.includes("Companion receipt</dt><dd>true"), true);
  assert.equal(execution.includes("afc-r3c-run.room-a-r1.receipt.json"), true);
  assert.equal(execution.includes(receiptSha256), true);
  assert.equal(execution.includes("0 / false"), false);
});
