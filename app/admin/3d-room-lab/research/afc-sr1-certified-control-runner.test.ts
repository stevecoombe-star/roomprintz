import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";

import {
  CompositorTransportError,
} from "@/lib/compositorTransportError";

import {
  canonicalizeRfc8785Jcs,
  sha256HexUtf8,
} from "../gemini-evidence-contract";
import {
  classifyAfcR3cImagePairCompatibility,
} from "./afc-r3c-image-pair-compatibility";
import type {
  AfcSr1TileGridScaffoldResult,
} from "./afc-sr1-tile-grid-scaffold";
import {
  AFC_SR1_CERTIFIED_PERMISSION_MODE,
  AFC_SR1_READINESS_CERTIFICATION_VERSION,
  AFC_SR1_TRANSPORT_ERROR_WIRE_VERSION,
  AfcSr1CertifiedPreflightError,
  createReaderWireTransport,
  probeWritableDirectory,
  runAfcSr1CertifiedControl,
  type CertifiedRunnerConfig,
  type RepositoryRuntimeState,
} from "./afc-sr1-certified-control-runner";

process.env.ROOMPRINTZ_COMPOSITOR_URL = "http://127.0.0.1:8000";

const fixtureDirectory = new URL(
  "./fixtures/afc-sr1-room-c-strict-semantic-handoff-control.v1/",
  import.meta.url
);

const fixedRepositoryState: RepositoryRuntimeState = Object.freeze({
  path: "/repo",
  branch: "control",
  sha: "a".repeat(40),
  upstream: "origin/control",
  ahead: 0,
  behind: 0,
  statusPorcelain: "",
  trackedDiffSha256: "b".repeat(64),
});

function readiness(readerEnabled = true) {
  return {
    schemaVersion: "afc-sr1-readiness/v2" as const,
    readerEnabled,
    placementEnabled: true,
    ts0GeneratorReady: true,
    ts0GeneratorProfile: "afc-sr1-tile-grid-scaffold/v1" as const,
    ts0RequestedModelId: "NBP" as const,
  };
}

async function directories(): Promise<Readonly<{
  root: string;
  execution: string;
  custody: string;
}>> {
  const root = await mkdtemp(join(tmpdir(), "afc-sr1-runner-"));
  const execution = await mkdtemp(join(root, "execution-"));
  const custody = await mkdtemp(join(root, "custody-"));
  return Object.freeze({ root, execution, custody });
}

function config(paths: Awaited<ReturnType<typeof directories>>): CertifiedRunnerConfig {
  return Object.freeze({
    uiRepository: "/ui",
    compositorRepository: "/compositor",
    executionDirectory: paths.execution,
    custodyDirectory: paths.custody,
    permissionMode: AFC_SR1_CERTIFIED_PERMISSION_MODE,
    invocationIdentity: "unit-control-invocation",
    ts0ResultAllowedHosts: [],
    ts0AllowLocalhostHttp: false,
  });
}

function v4ReaderReceipt(source: any): unknown {
  const receipt = structuredClone(source);
  const diagnostics = receipt.diagnostics;
  const eligibility = (familyIndices: readonly [number, number]) => ({
    familyIndices,
    eligible: true,
    failedStage: null,
    rejectionReason: null,
    overlapFractionOfSmaller: 0,
    firstSupportCount: 8,
    secondSupportCount: 8,
    firstInlierBandCount: 0,
    secondInlierBandCount: 0,
    firstInlierBandFraction: 0,
    secondInlierBandFraction: 0,
    firstRegionMedianDegrees: 11,
    secondRegionMedianDegrees: 17,
    strongRegionMedianDegrees: 17,
  });
  const validPairUniverse = diagnostics.validPairUniverse.map((pair: any) => ({
    ...pair,
    independentDirectionEligibility: eligibility(pair.familyIndices),
  }));
  const winningPair = {
    ...diagnostics.winningPair,
    independentDirectionEligibility: eligibility(
      diagnostics.winningPair.familyIndices
    ),
  };
  receipt.schemaVersion = "afc-sr1-tr2-tile-floor-reader-result/v4";
  receipt.researchProfile = "afc-sr1-tr2-tile-floor-reader/v4";
  receipt.policyVersion = "afc-sr1-ts2-extractor-policy/v4";
  receipt.runtimeIdentity.readerModuleVersion = "afc-sr1-tile-floor-reader/v4";
  receipt.diagnostics = {
    ...diagnostics,
    stableProjectivelyValidPairCount: diagnostics.validPairCount,
    eligiblePairCount: diagnostics.validPairCount,
    validPairCount: diagnostics.validPairCount,
    independentDirectionEligibilityRejectedPairs: [],
    validPairUniverse,
    winningPair,
  };
  const preimage = {
    schemaVersion: receipt.schemaVersion,
    researchProfile: receipt.researchProfile,
    policyVersion: receipt.policyVersion,
    image: receipt.imageIdentity,
    roi: receipt.roiIdentity,
    runtime: receipt.runtimeIdentity,
    status: receipt.status,
    diagnostics: {
      segmentCounts: receipt.diagnostics.segmentCounts ?? null,
      candidateDiscovery: receipt.diagnostics.candidateDiscovery ?? null,
      validFamilyCount: receipt.diagnostics.validFamilyCount ?? null,
      candidateUnorderedPairCount:
        receipt.diagnostics.candidateUnorderedPairCount ?? null,
      stableProjectivelyValidPairCount:
        receipt.diagnostics.stableProjectivelyValidPairCount ?? null,
      eligiblePairCount: receipt.diagnostics.eligiblePairCount ?? null,
      validPairCount: receipt.diagnostics.validPairCount ?? null,
      invalidPairs: receipt.diagnostics.invalidPairs ?? null,
      independentDirectionEligibilityRejectedPairs:
        receipt.diagnostics.independentDirectionEligibilityRejectedPairs ?? null,
      validPairUniverse: receipt.diagnostics.validPairUniverse ?? null,
      finalFamilies: receipt.diagnostics.candidateDiscovery?.finalFamilies ?? null,
      winningPair: receipt.diagnostics.winningPair ?? null,
    },
    analysisIdentity: receipt.analysisIdentity,
    floorVanishingLinePixel: receipt.floorVanishingLinePixel,
  };
  receipt.evidenceCanonicalJson = canonicalizeRfc8785Jcs(preimage);
  receipt.evidenceDigest.value =
    sha256HexUtf8(receipt.evidenceCanonicalJson);
  return receipt;
}

async function roomCRawReceipt(): Promise<unknown> {
  const control = JSON.parse(
    await readFile(new URL("control.json", fixtureDirectory), "utf8")
  );
  return v4ReaderReceipt(control.realCompositorV3Evidence["C-RAW"].receipt);
}

async function roomCRejectedRawReceipt(): Promise<unknown> {
  const receipt = await roomCRawReceipt() as {
    status: "usable" | "rejected";
    reason?: string;
    floorVanishingLinePixel?: unknown;
    evidenceCanonicalJson: string;
    evidenceDigest: { value: string };
  };
  const preimage = JSON.parse(receipt.evidenceCanonicalJson) as {
    status: "usable" | "rejected";
    reason?: string;
    floorVanishingLinePixel?: unknown;
  };
  receipt.status = "rejected";
  receipt.reason = "invalid_roi";
  delete receipt.floorVanishingLinePixel;
  preimage.status = "rejected";
  preimage.reason = "invalid_roi";
  delete preimage.floorVanishingLinePixel;
  receipt.evidenceCanonicalJson = canonicalizeRfc8785Jcs(preimage);
  receipt.evidenceDigest.value =
    sha256HexUtf8(receipt.evidenceCanonicalJson);
  return receipt;
}

async function cT1Receipts(): Promise<Readonly<{
  placement: unknown;
  childReader: unknown;
}>> {
  const [control, placementControl] = await Promise.all([
    readFile(new URL("control.json", fixtureDirectory), "utf8").then(JSON.parse),
    readFile(
      new URL(
        "./fixtures/afc-sr1-room-c-placement-bound-control.v1.json",
        import.meta.url
      ),
      "utf8"
    ).then(JSON.parse),
  ]);
  return Object.freeze({
    placement: structuredClone(placementControl.placements["C-T1"].receipt),
    childReader: v4ReaderReceipt(control.realCompositorV3Evidence["C-T1"].receipt),
  });
}

async function cT1ScaffoldResult(): Promise<AfcSr1TileGridScaffoldResult> {
  const [control, lineage] = await Promise.all([
    readFile(new URL("control.json", fixtureDirectory), "utf8").then(JSON.parse),
    readFile(
      new URL(
        "./fixtures/afc-sr1-room-c-ts0-lineage-control.v1.json",
        import.meta.url
      ),
      "utf8"
    ).then(JSON.parse),
  ]);
  const metadata = lineage.results["C-T1"];
  const childBytes = await readFile(
    new URL(
      control.realCompositorV3Evidence["C-T1"].imageFixtureFile,
      fixtureDirectory
    )
  );
  return {
    status: "generated",
    input: structuredClone(lineage.parent),
    tiled: {
      base64: childBytes.toString("base64"),
      identity: structuredClone(metadata.child),
    },
    provenance: structuredClone(metadata.provenance),
    compatibility: classifyAfcR3cImagePairCompatibility(
      {
        fingerprint: lineage.parent.sha256,
        decodedWidth: lineage.parent.decodedWidth,
        decodedHeight: lineage.parent.decodedHeight,
        orientation: lineage.parent.orientation,
      },
      {
        fingerprint: metadata.child.sha256,
        decodedWidth: metadata.child.decodedWidth,
        decodedHeight: metadata.child.decodedHeight,
        orientation: metadata.child.orientation,
      }
    ),
  };
}

test("writeability probe fsyncs, renames, reads back, and removes its files", async () => {
  const paths = await directories();
  const result = await probeWritableDirectory(paths.execution, () => "fixed");
  assert.deepEqual(result, {
    directory: paths.execution,
    status: "pass",
    fsync: true,
    atomicRename: true,
    readBack: true,
    cleanup: true,
  });
  await assert.rejects(stat(join(paths.execution, ".afc-sr1-write-probe-fixed.tmp")));
  await assert.rejects(stat(join(paths.execution, ".afc-sr1-write-probe-fixed.ready")));
});

test("writeability failure stops before readiness and every scientific dispatch", async () => {
  const paths = await directories();
  let readinessCalls = 0;
  let rawCalls = 0;
  let pathACalls = 0;
  await assert.rejects(
    runAfcSr1CertifiedControl(config(paths), {
      readRepositoryState: async () => fixedRepositoryState,
      probeWritableDirectory: async (directory) => {
        if (directory === paths.custody) {
          throw Object.assign(new Error("permission denied"), { code: "EPERM" });
        }
        return {
          directory,
          status: "pass",
          fsync: true,
          atomicRename: true,
          readBack: true,
          cleanup: true,
        };
      },
      callReadiness: async () => {
        readinessCalls += 1;
        return readiness();
      },
      callRawReader: async () => {
        rawCalls += 1;
        return {};
      },
      executePathA: async () => {
        pathACalls += 1;
        throw new Error("must not execute");
      },
    }),
    (error) =>
      error instanceof AfcSr1CertifiedPreflightError &&
      error.stage === 1 &&
      error.code === "repository_or_writeability_check_failed"
  );
  assert.equal(readinessCalls, 0);
  assert.equal(rawCalls, 0);
  assert.equal(pathACalls, 0);
});

test("gate readiness failure stops before integrated PATH A", async () => {
  const paths = await directories();
  let pathACalls = 0;
  await assert.rejects(
    runAfcSr1CertifiedControl(config(paths), {
      readRepositoryState: async () => fixedRepositoryState,
      callHealth: async () => ({ status: "ok" }),
      callReadiness: async () => readiness(false),
      executePathA: async () => {
        pathACalls += 1;
        throw new Error("must not execute");
      },
    }),
    (error) =>
      error instanceof AfcSr1CertifiedPreflightError &&
      error.stage === 2 &&
      error.code === "scientific_gate_disabled"
  );
  assert.equal(pathACalls, 0);
});

test("TS0 generator prerequisite failure stops before every PATH A control", async () => {
  const paths = await directories();
  let pathACalls = 0;
  await assert.rejects(
    runAfcSr1CertifiedControl(config(paths), {
      readRepositoryState: async () => fixedRepositoryState,
      callHealth: async () => ({ status: "ok" }),
      callReadiness: async () => ({
        ...readiness(),
        ts0GeneratorReady: false,
      }),
      executePathA: async () => {
        pathACalls += 1;
        throw new Error("must not execute");
      },
    }),
    (error) =>
      error instanceof AfcSr1CertifiedPreflightError &&
      error.stage === 2 &&
      error.code === "ts0_generator_prerequisite_failed"
  );
  assert.equal(pathACalls, 0);
});

test("error wire captures typed 404 without secrets or image payload", async () => {
  const paths = await directories();
  const wire = createReaderWireTransport({
    directory: paths.execution,
    seam: "raw-reader",
    now: () => new Date("2026-08-12T19:00:00.000Z"),
    call: async () => {
      assert.ok(wire.state.requestPath);
      throw new CompositorTransportError({
        seam: "tile-floor-reader",
        classification: "http_404",
        httpStatus: 404,
        endpoint: {
          host: "127.0.0.1",
          port: "8000",
          path: "/api/research/afc-sr1/tile-floor-vanishing-line",
        },
      });
    },
  });
  await assert.rejects(
    wire.call({
      payload: {
        researchProfile: "afc-sr1-tr2-tile-floor-reader/v4",
        policyVersion: "afc-sr1-ts2-extractor-policy/v4",
        imageBase64: Buffer.from("scientific-image-secret").toString("base64"),
        roi: { coordinateSpace: "source-normalized/v1", polygon: [] },
      },
    }),
    CompositorTransportError
  );
  assert.ok(wire.state.errorPath);
  assert.equal(wire.state.responsePath, null);
  const serialized = await readFile(wire.state.errorPath!, "utf8");
  const artifact = JSON.parse(serialized);
  assert.equal(artifact.schemaVersion, AFC_SR1_TRANSPORT_ERROR_WIRE_VERSION);
  assert.equal(artifact.class, "http_404");
  assert.equal(artifact.httpStatus, 404);
  assert.equal(artifact.seam, "raw-reader");
  assert.doesNotMatch(serialized, /scientific-image-secret|imageBase64|Bearer|Authorization/);
});

test("Room C control runs actual integrated PATH A and emits bound report", async () => {
  const paths = await directories();
  const receipt = await roomCRawReceipt();
  const seamReceipts = await cT1Receipts();
  const scaffold = await cT1ScaffoldResult();
  let rawCalls = 0;
  let ts0Calls = 0;
  let placementCalls = 0;
  let childCalls = 0;
  const completed = await runAfcSr1CertifiedControl(config(paths), {
    now: () => new Date("2026-08-12T19:00:00.000Z"),
    createId: () => "fixed-probe",
    readRepositoryState: async () => fixedRepositoryState,
    callHealth: async () => ({ status: "ok" }),
    callReadiness: async () => readiness(),
    callRawReader: async () => {
      rawCalls += 1;
      return structuredClone(receipt);
    },
    executeTs0: async () => {
      ts0Calls += 1;
      return structuredClone(scaffold);
    },
    callPlacement: async () => {
      placementCalls += 1;
      return structuredClone(seamReceipts.placement);
    },
    callChildReader: async () => {
      childCalls += 1;
      return structuredClone(seamReceipts.childReader);
    },
  });
  assert.equal(rawCalls, 2);
  assert.equal(ts0Calls, 1);
  assert.equal(placementCalls, 1);
  assert.equal(childCalls, 1);
  const report = JSON.parse(await readFile(completed.artifactPath, "utf8"));
  assert.equal(report.schemaVersion, AFC_SR1_READINESS_CERTIFICATION_VERSION);
  assert.equal(report.overallStatus, "PASS");
  assert.equal(report.controls.principal.resultMode, "raw-direct");
  assert.equal(report.controls.principal.finalReason, null);
  assert.equal(report.controls.principal.receiptPresent, true);
  assert.equal(report.controls.principal.replayValid, true);
  assert.equal(report.controls.principal.wires.raw.errorPath, null);
  assert.ok(report.controls.principal.wires.raw.responsePath);
  assert.equal(
    report.stages.stage3RoomCPrincipalRawDirectPathA.status,
    "PASS"
  );
  assert.equal(
    report.stages.stage4LiveDevelopmentTs0StructureLineage.status,
    "PASS"
  );
  assert.equal(
    report.stages.stage5PlacementAndChildReaderLiveSeams.status,
    "PASS"
  );
  assert.equal(
    report.stages.stage6IntegratedInjectedDevelopmentFallbackPathA.status,
    "PASS"
  );
  assert.equal(report.controls.fallback.status, "PASS");
  assert.equal(
    report.controls.fallback.certificationClaim,
    "injected_fallback_live_ts0_placement_child_path_certified"
  );
  assert.equal(report.controls.fallback.resultMode, "tiled-placement");
  assert.equal(report.controls.fallback.placementStatus, "usable");
  assert.equal(report.controls.fallback.childReaderStatus, "usable");
  assert.deepEqual(report.controls.fallback.attemptCounts, {
    rawReader: 1,
    ts0: 1,
    placement: 1,
    childReader: 1,
    placementBoundHandoff: 1,
    tiledProjective: 1,
  });
  assert.equal(report.controls.fallback.ts0.dispatchCount, 1);
  assert.equal(report.controls.fallback.ts0.resultStatus, "generated");
  assert.equal(report.controls.fallback.ts0.generationTimeoutMs, 120_000);
  assert.equal(
    report.stages.stage4LiveDevelopmentTs0StructureLineage
      .mandatoryForOverallPass,
    true
  );
  assert.equal(
    report.stages.stage5PlacementAndChildReaderLiveSeams
      .cannotRescueFailedStage4,
    true
  );
  assert.equal(
    await readFile(completed.custodyArtifactPath, "utf8"),
    await readFile(completed.artifactPath, "utf8")
  );
});

test("failed live TS0 readiness blocks PASS and cannot be rescued by placement or child seams", async () => {
  const paths = await directories();
  const receipt = await roomCRawReceipt();
  let rawCalls = 0;
  let ts0Calls = 0;
  let placementCalls = 0;
  let childCalls = 0;
  await assert.rejects(
    runAfcSr1CertifiedControl(config(paths), {
      now: () => new Date("2026-08-12T19:00:00.000Z"),
      createId: () => "fixed-probe",
      readRepositoryState: async () => fixedRepositoryState,
      callHealth: async () => ({ status: "ok" }),
      callReadiness: async () => readiness(),
      callRawReader: async () => {
        rawCalls += 1;
        return structuredClone(receipt);
      },
      executeTs0: async () => {
        ts0Calls += 1;
        return {
          status: "failure",
          code: "timeout",
          runId: "one-authorized-attempt",
        };
      },
      callPlacement: async () => {
        placementCalls += 1;
        return {};
      },
      callChildReader: async () => {
        childCalls += 1;
        return {};
      },
    }),
    /Integrated AFC-SR1 control certification failed/
  );
  assert.equal(rawCalls, 2);
  assert.equal(ts0Calls, 1);
  assert.equal(placementCalls, 0);
  assert.equal(childCalls, 0);
  const report = JSON.parse(
    await readFile(
      join(
        paths.execution,
        "afc-sr1-integrated-path-a-readiness-certification.v2.json"
      ),
      "utf8"
    )
  );
  assert.equal(report.overallStatus, "FAIL");
  assert.equal(
    report.stages.stage4LiveDevelopmentTs0StructureLineage.status,
    "FAIL"
  );
  assert.equal(
    report.stages.stage5PlacementAndChildReaderLiveSeams.status,
    "FAIL"
  );
  assert.equal(report.controls.fallback.ts0.dispatchCount, 1);
  assert.equal(report.controls.fallback.ts0.failureCode, "timeout");
  assert.equal(report.controls.fallback.certificationClaim, null);
  assert.deepEqual(report.controls.fallback.attemptCounts, {
    rawReader: 1,
    ts0: 1,
    placement: 0,
    childReader: 0,
    placementBoundHandoff: 0,
    tiledProjective: 0,
  });
});

test("valid rejected Room C receipt cannot certify or be rescued by C-T1 seams", async () => {
  const paths = await directories();
  const rejectedReceipt = await roomCRejectedRawReceipt();
  const seamReceipts = await cT1Receipts();
  let rawCalls = 0;
  let placementCalls = 0;
  let childCalls = 0;
  await assert.rejects(
    runAfcSr1CertifiedControl(config(paths), {
      now: () => new Date("2026-08-12T19:00:00.000Z"),
      createId: () => "fixed-probe",
      readRepositoryState: async () => fixedRepositoryState,
      callHealth: async () => ({ status: "ok" }),
      callReadiness: async () => readiness(),
      callRawReader: async () => {
        rawCalls += 1;
        return structuredClone(rejectedReceipt);
      },
      callPlacement: async () => {
        placementCalls += 1;
        return structuredClone(seamReceipts.placement);
      },
      callChildReader: async () => {
        childCalls += 1;
        return structuredClone(seamReceipts.childReader);
      },
    }),
    /Integrated AFC-SR1 control certification failed/
  );
  assert.equal(rawCalls, 1);
  assert.equal(placementCalls, 0);
  assert.equal(childCalls, 0);
  const report = JSON.parse(await readFile(
    join(
      paths.execution,
      "afc-sr1-integrated-path-a-readiness-certification.v2.json"
    ),
    "utf8"
  ));
  assert.equal(report.controls.principal.receiptPresent, true);
  assert.equal(report.controls.principal.resultMode, "rejected");
  assert.equal(
    report.controls.principal.finalReason,
    "raw_reader_rejected"
  );
  assert.equal(report.overallStatus, "FAIL");
  assert.equal(
    report.stages.stage3RoomCPrincipalRawDirectPathA.status,
    "FAIL"
  );
  assert.deepEqual(report.controls.fallback, {
    identity: "not_run_principal_control_failed",
    certificationClaim: null,
    rejectionMechanism: null,
    status: "FAIL",
  });
});

test("live local gate-off HTTP 404 writes typed error wire and PATH A remains transport_failure", async () => {
  const paths = await directories();
  const dispatches = {
    health: 0,
    readiness: 0,
    rawReader: 0,
    placement: 0,
  };
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/health") {
      dispatches.health += 1;
      response.end('{"status":"ok"}');
      return;
    }
    if (request.url === "/api/research/afc-sr1/readiness") {
      dispatches.readiness += 1;
      response.end(
        '{"schemaVersion":"afc-sr1-readiness/v2","readerEnabled":true,"placementEnabled":true,"ts0GeneratorReady":true,"ts0GeneratorProfile":"afc-sr1-tile-grid-scaffold/v1","ts0RequestedModelId":"NBP"}'
      );
      return;
    }
    if (
      request.url ===
      "/api/research/afc-sr1/tile-floor-vanishing-line"
    ) {
      dispatches.rawReader += 1;
      response.statusCode = 404;
      response.end('{"detail":"Not Found"}');
      return;
    }
    if (
      request.url ===
      "/api/research/afc-sr1/ts0-child-projective-placement"
    ) {
      dispatches.placement += 1;
    }
    response.statusCode = 500;
    response.end('{"detail":"unexpected route"}');
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve)
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const originalUrl = process.env.ROOMPRINTZ_COMPOSITOR_URL;
  process.env.ROOMPRINTZ_COMPOSITOR_URL =
    `http://127.0.0.1:${address.port}`;
  try {
    await assert.rejects(
      runAfcSr1CertifiedControl(config(paths), {
        now: () => new Date("2026-08-12T19:00:00.000Z"),
        createId: () => "fixed-probe",
        readRepositoryState: async () => fixedRepositoryState,
      }),
      /Integrated AFC-SR1 control certification failed/
    );
  } finally {
    process.env.ROOMPRINTZ_COMPOSITOR_URL = originalUrl;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
  assert.deepEqual(dispatches, {
    health: 1,
    readiness: 1,
    rawReader: 1,
    placement: 0,
  });
  const reportPath = join(
    paths.execution,
    "afc-sr1-integrated-path-a-readiness-certification.v2.json"
  );
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.controls.principal.resultMode, "rejected");
  assert.equal(report.controls.principal.finalReason, "transport_failure");
  assert.equal(report.controls.principal.receiptPresent, false);
  assert.deepEqual(report.controls.principal.attemptCounts, {
    rawReader: 1,
    ts0: 0,
    placement: 0,
    childReader: 0,
    placementBoundHandoff: 0,
    tiledProjective: 0,
  });
  assert.ok(report.controls.principal.wires.raw.errorPath);
  assert.equal(report.controls.principal.wires.raw.responsePath, null);
  const errorWire = JSON.parse(
    await readFile(report.controls.principal.wires.raw.errorPath, "utf8")
  );
  assert.equal(errorWire.class, "http_404");
  assert.equal(errorWire.httpStatus, 404);
});
