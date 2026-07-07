import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
  evaluateCalibrationImageBasisEvidence,
} from "@/app/admin/3d-room-lab/calibration-image-basis";
import { validateG0ObservedRunRecord, type G0ObservedRunRecord } from "../observed-run-record";
import {
  buildNonPStaleObservedRunRecord,
  buildNonPStaleRunMetadata,
  parseNonPStaleMinimalInput,
  type NonPStaleExecutionEvidence,
  type NonPStaleMinimalInput,
} from "../non-p-stale-observed-run-builder";
import { shouldDiscardAttestedResponse } from "@/app/admin/3d-room-lab/policy-a-containment";
import { evaluateCalibrationRestoreCompatibility } from "@/app/admin/3d-room-lab/scene-state";
import {
  buildPcropComparisonImageBasis,
  buildPcropPersistedParentCalibration,
  buildPurlDriftPersistedCalibration,
  buildPurlDriftRestoreImageBasis,
  P_CROP_PINNED_SOURCE_IMAGE_URL,
  runDeterministicFirstSliceExecution,
} from "../non-p-stale-first-slice-execution";
import { P_DIMENSION_PINNED_SYNTHETIC_DIMENSIONS } from "../p-dimension-route-harness";
import {
  P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS,
  P_URL_DRIFT_PINNED_SOURCE_IMAGE_URL,
} from "../p-url-drift-route-harness";
import { X4_PINNED_MATCHING_DIMENSIONS } from "../x4-exif-route-harness";

const includesNonPStaleEntry = process.argv.some((arg) => arg.endsWith("non-p-stale-observed-run.test.ts"));
const includesStandalonePdimensionHarness = process.argv.some((arg) =>
  arg.endsWith("p-dimension-route-harness.test.ts")
);
if (includesNonPStaleEntry && !includesStandalonePdimensionHarness) {
  require("./p-dimension-route-harness.test");
}
const includesStandaloneX4Harness = process.argv.some((arg) =>
  arg.endsWith("x4-exif-route-harness.test.ts")
);
if (includesNonPStaleEntry && !includesStandaloneX4Harness) {
  require("./x4-exif-route-harness.test");
}
const includesStandalonePurlDriftHarness = process.argv.some((arg) =>
  arg.endsWith("p-url-drift-route-harness.test.ts")
);
if (includesNonPStaleEntry && !includesStandalonePurlDriftHarness) {
  require("./p-url-drift-route-harness.test");
}
import {
  NON_P_STALE_DECLARATION_BINDINGS,
  resolveNonPStaleProvenance,
  type NonPStaleProbeId,
} from "../non-p-stale-provenance-resolver";
import { NON_P_STALE_NO_AUTHORITY_PROFILES } from "../non-p-stale-no-authority-profiles";
import {
  G0_PAYLOAD_FIXTURES,
  G0_SYNTHETIC_ASSETS,
  type G0PayloadFixtureId,
  type G0SyntheticAssetId,
} from "../assets-and-lineage";

const NON_P_STALE_PROBES: readonly NonPStaleProbeId[] = [
  "P-crop",
  "P-empty",
  "P-gen",
  "P-url-drift",
  "P-dimension-mismatch",
  "P-coordinate-space-drift",
  "P-legacy",
  "X4",
];

const CLI_PATH = path.join(process.cwd(), "app/admin/3d-room-lab/g0-containment/write-g0-observed-run.ts");
const REPO_RECEIPTS_ROOT = path.join(
  process.cwd(),
  "app/admin/3d-room-lab/g0-containment/receipts"
);

type CliRunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function runCli(args: string[]): CliRunResult {
  const result = spawnSync(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", CLI_PATH, ...args],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function buildMinimalInput(overrides?: Partial<NonPStaleMinimalInput>): NonPStaleMinimalInput {
  return {
    createdAt: "2026-07-06T19:00:00.000Z",
    executionNonce: "deterministic-first-slice-1",
    supersedesRunId: null,
    rerunReason: "evaluation_changed",
    ...overrides,
  };
}

function countExact(values: readonly string[], expected: string): number {
  return values.filter((value) => value === expected).length;
}

function replaceFirstExact(
  values: readonly string[],
  expected: string,
  replacement: string
): readonly string[] {
  const index = values.indexOf(expected);
  assert.ok(index >= 0);
  const mutated = [...values];
  mutated[index] = replacement;
  return mutated;
}

function removeReferencesWithPrefix(values: readonly string[], prefix: string): readonly string[] {
  return values.filter((value) => !value.startsWith(prefix));
}

async function writeInputFile(root: string, data: unknown): Promise<string> {
  const inputPath = path.join(root, "input.json");
  await writeFile(inputPath, JSON.stringify(data, null, 2), "utf8");
  return inputPath;
}

async function countJsonFiles(root: string): Promise<number> {
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    const fullPath = path.join(root, entry);
    const stat = await readdir(fullPath).then(
      () => "dir" as const,
      () => "file" as const
    );
    if (stat === "dir") {
      count += await countJsonFiles(fullPath);
    } else if (entry.endsWith(".json")) {
      count += 1;
    }
  }
  return count;
}

async function collectJsonFileHashes(root: string): Promise<readonly string[]> {
  const digests: string[] = [];
  async function visit(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const bytes = await readFile(fullPath);
      const digest = createHash("sha256").update(bytes).digest("hex");
      digests.push(`${path.relative(root, fullPath)}:${digest}`);
    }
  }
  await visit(root);
  return digests.sort();
}

async function withMutatedSyntheticAsset<T>(
  assetId: G0SyntheticAssetId,
  mutate: (asset: any) => void,
  fn: () => Promise<T>
): Promise<T> {
  const asset = G0_SYNTHETIC_ASSETS[assetId] as any;
  const snapshot = { ...asset };
  mutate(asset);
  try {
    return await fn();
  } finally {
    Object.assign(asset, snapshot);
  }
}

async function withMutatedPayloadFixture<T>(
  fixtureId: G0PayloadFixtureId,
  mutate: (fixture: any) => void,
  fn: () => Promise<T>
): Promise<T> {
  const fixture = G0_PAYLOAD_FIXTURES[fixtureId] as any;
  const snapshot = { ...fixture };
  mutate(fixture);
  try {
    return await fn();
  } finally {
    Object.assign(fixture, snapshot);
  }
}

test("all eight non-P-stale probes resolve through explicit logical-id bindings", async () => {
  for (const probeId of NON_P_STALE_PROBES) {
    const binding = NON_P_STALE_DECLARATION_BINDINGS[probeId];
    const resolved = await resolveNonPStaleProvenance(probeId);
    assert.equal(resolved.probeId, probeId);
    assert.equal(resolved.fixtureDeclarationIdentity.declaredProbeId, probeId);
    assert.equal(resolved.canonicalPublicUrl, null);
    assert.ok(resolved.canonicalRepoRelativePaths.length > 0);
    if (binding.bindingKind === "payload") {
      assert.equal(resolved.payloadIdentity, binding.declarationPayloadIdentity);
      assert.equal(resolved.payloadDigest, G0_PAYLOAD_FIXTURES[binding.payloadFixtureId].payloadDigest);
    } else if (binding.bindingKind === "image_with_drift") {
      assert.equal(resolved.runIdentityBasisFingerprint, G0_SYNTHETIC_ASSETS["A-parent"].sha256);
      assert.equal(resolved.driftImageDigest, G0_SYNTHETIC_ASSETS["A-drift-b"].sha256);
    } else {
      assert.equal(resolved.runIdentityBasisFingerprint, G0_SYNTHETIC_ASSETS[binding.registryAssetId].sha256);
    }
  }
});

test("resolver fails closed on digest, metadata, orientation, path, and lineage drift", async () => {
  await withMutatedSyntheticAsset(
    "A-crop",
    (asset) => {
      asset.sha256 = "f".repeat(64);
    },
    async () => {
      await assert.rejects(resolveNonPStaleProvenance("P-crop"), /image_digest_drift/);
    }
  );

  await withMutatedSyntheticAsset(
    "A-empty",
    (asset) => {
      asset.decodedWidth = asset.decodedWidth + 1;
    },
    async () => {
      await assert.rejects(resolveNonPStaleProvenance("P-empty"), /image_metadata_drift/);
    }
  );

  await withMutatedSyntheticAsset(
    "A-exif",
    (asset) => {
      asset.encodedOrientation = 1;
    },
    async () => {
      await assert.rejects(resolveNonPStaleProvenance("X4"), /image_metadata_drift/);
    }
  );

  await withMutatedSyntheticAsset(
    "A-gen",
    (asset) => {
      asset.fileName = "A-parent.jpg";
    },
    async () => {
      await assert.rejects(resolveNonPStaleProvenance("P-gen"), /image_digest_drift/);
    }
  );

  await withMutatedSyntheticAsset(
    "A-crop",
    (asset) => {
      asset.decodedWidth = asset.decodedWidth + 1;
    },
    async () => {
      await assert.rejects(resolveNonPStaleProvenance("P-crop"), /image_metadata_drift/);
    }
  );

  await withMutatedSyntheticAsset(
    "A-crop",
    (asset) => {
      asset.parentAssetId = null;
    },
    async () => {
      await assert.rejects(resolveNonPStaleProvenance("P-crop"), /registry_asset_parent_lineage_mismatch/);
    }
  );
});

test("resolver fails closed on payload digest and identity drift", async () => {
  await withMutatedPayloadFixture(
    "P-legacy",
    (fixture) => {
      fixture.payloadDigest = "0".repeat(64);
    },
    async () => {
      await assert.rejects(resolveNonPStaleProvenance("P-legacy"), /payload_digest_drift/);
    }
  );

  await withMutatedPayloadFixture(
    "P-coordinate-space-drift",
    (fixture) => {
      fixture.payloadIdentity = "payload-coordinate-space-drift-v1-mutated";
    },
    async () => {
      await assert.rejects(
        resolveNonPStaleProvenance("P-coordinate-space-drift"),
        /payload_identity_(mapping_)?drift/
      );
    }
  );
});

test("P-url-drift binds parent and drift digests separately", async () => {
  const provenance = await resolveNonPStaleProvenance("P-url-drift");
  assert.equal(provenance.runIdentityBasisFingerprint, G0_SYNTHETIC_ASSETS["A-parent"].sha256);
  assert.equal(provenance.driftImageDigest, G0_SYNTHETIC_ASSETS["A-drift-b"].sha256);
  assert.notEqual(provenance.runIdentityBasisFingerprint, provenance.driftImageDigest);
});

test("payload probes use payload digest as run identity and never embedded image fingerprint", async () => {
  const provenance = await resolveNonPStaleProvenance("P-coordinate-space-drift");
  const loaded = JSON.parse(
    await readFile(
      path.join(
        process.cwd(),
        "app/admin/3d-room-lab/g0-containment/payload-fixtures/P-coordinate-space-drift.v1.json"
      ),
      "utf8"
    )
  ) as { calibration: { source: { imageBasis: { basisFingerprint: string } } } };
  assert.equal(provenance.runIdentityBasisFingerprint, provenance.payloadDigest);
  assert.notEqual(
    provenance.runIdentityBasisFingerprint,
    loaded.calibration.source.imageBasis.basisFingerprint
  );
});

test("builder enforces exact emitted-result equality and rejects stale probe", async () => {
  const provenance = await resolveNonPStaleProvenance("P-legacy");
  const execution = await runDeterministicFirstSliceExecution({
    probeId: "P-legacy",
    provenance,
  });
  const runMetadata = await buildNonPStaleRunMetadata({
    minimalInput: buildMinimalInput(),
    provenance,
  });
  const wrongTokenExecution: NonPStaleExecutionEvidence = {
    ...execution,
    emittedResult: "basis_coordinate_space_mismatch",
  };
  assert.throws(
    () =>
      buildNonPStaleObservedRunRecord({
        probeId: "P-legacy",
        provenance,
        runMetadata,
        execution: wrongTokenExecution,
      }),
    /emitted_result_must_match_declaration_exactly/
  );
  assert.throws(
    () =>
      buildNonPStaleObservedRunRecord({
        probeId: "P-stale" as NonPStaleProbeId,
        provenance,
        runMetadata,
        execution,
      }),
    /non_p_stale_builder_rejects_p_stale/
  );
});

test("builder rejects unknown, duplicate, and missing required supporting checks", async () => {
  const provenance = await resolveNonPStaleProvenance("P-coordinate-space-drift");
  const execution = await runDeterministicFirstSliceExecution({
    probeId: "P-coordinate-space-drift",
    provenance,
  });
  const runMetadata = await buildNonPStaleRunMetadata({
    minimalInput: buildMinimalInput(),
    provenance,
  });

  assert.throws(
    () =>
      buildNonPStaleObservedRunRecord({
        probeId: "P-coordinate-space-drift",
        provenance,
        runMetadata,
        execution: {
          ...execution,
          supportingChecks: [
            ...execution.supportingChecks,
            {
              checkId: "unknown_check",
              status: "passed",
              failureClass: null,
            },
          ],
        },
      }),
    /unknown_supporting_check/
  );

  assert.throws(
    () =>
      buildNonPStaleObservedRunRecord({
        probeId: "P-coordinate-space-drift",
        provenance,
        runMetadata,
        execution: {
          ...execution,
          supportingChecks: [
            execution.supportingChecks[0],
            execution.supportingChecks[0],
          ],
        },
      }),
    /duplicate_supporting_check/
  );

  assert.throws(
    () =>
      buildNonPStaleObservedRunRecord({
        probeId: "P-coordinate-space-drift",
        provenance,
        runMetadata,
        execution: {
          ...execution,
          supportingChecks: [execution.supportingChecks[0]],
        },
      }),
    /missing_required_supporting_check/
  );
});

test("builder de-duplicates exact artifact references and preserves first occurrence order", async () => {
  const provenance = await resolveNonPStaleProvenance("P-legacy");
  const execution = await runDeterministicFirstSliceExecution({
    probeId: "P-legacy",
    provenance,
  });
  const runMetadata = await buildNonPStaleRunMetadata({
    minimalInput: buildMinimalInput(),
    provenance,
  });
  const duplicateOnly = "custom:exact";
  const distinctVariant = "custom:exact ";
  const record = buildNonPStaleObservedRunRecord({
    probeId: "P-legacy",
    provenance,
    runMetadata,
    execution: {
      ...execution,
      artifactReferences: [...execution.artifactReferences, duplicateOnly, duplicateOnly, distinctVariant],
    },
  });

  assert.equal(countExact(record.artifactReferences, duplicateOnly), 1);
  assert.equal(countExact(record.artifactReferences, distinctVariant), 1);

  const fixturePayloadPath = provenance.artifactReferences.find((entry) =>
    entry.startsWith("fixture_payload_path:")
  );
  const payloadIdentity = `payload_identity:${provenance.payloadIdentity}`;
  const payloadDigest = `payload_digest:${provenance.payloadDigest}`;
  const executionMode = "execution_mode:deterministic_execution_observed";

  assert.ok(fixturePayloadPath);
  const fixturePayloadPathIndex = record.artifactReferences.indexOf(fixturePayloadPath!);
  const payloadIdentityIndex = record.artifactReferences.indexOf(payloadIdentity);
  const payloadDigestIndex = record.artifactReferences.indexOf(payloadDigest);
  const duplicateOnlyIndex = record.artifactReferences.indexOf(duplicateOnly);
  const executionModeIndex = record.artifactReferences.indexOf(executionMode);
  const distinctVariantIndex = record.artifactReferences.indexOf(distinctVariant);

  assert.ok(fixturePayloadPathIndex >= 0);
  assert.ok(payloadIdentityIndex > fixturePayloadPathIndex);
  assert.ok(payloadDigestIndex > payloadIdentityIndex);
  assert.ok(duplicateOnlyIndex > payloadDigestIndex);
  assert.ok(distinctVariantIndex > duplicateOnlyIndex);
  assert.ok(executionModeIndex > distinctVariantIndex);
});

test("all eight no-authority profiles exist and include all seven axes", () => {
  for (const probeId of NON_P_STALE_PROBES) {
    const profile = NON_P_STALE_NO_AUTHORITY_PROFILES[probeId];
    assert.ok(profile);
    assert.deepEqual(Object.keys(profile).sort(), [
      "apply_gate_defense_in_depth",
      "client_discard_predicate",
      "live_snapshot_state_observation",
      "qualification_refusal_result",
      "restore_or_import_result",
      "route_response_result",
      "state_transition_predicate",
    ]);
  }
});

test("deterministic adapters produce audited first-slice tokens and supporting checks", async () => {
  const pgenProvenance = await resolveNonPStaleProvenance("P-gen");
  const originalFetch = globalThis.fetch;
  const pgenExecution = await (async () => {
    try {
      globalThis.fetch = (() => {
        throw new Error("fetch_must_not_be_invoked");
      }) as typeof globalThis.fetch;
      return runDeterministicFirstSliceExecution({
        probeId: "P-gen",
        provenance: pgenProvenance,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  })();
  assert.equal(pgenExecution.mode, "deterministic_execution_observed");
  assert.equal(pgenExecution.emittedResult, "basis_derivative_not_authority_eligible");
  assert.equal(pgenExecution.expectedVsObservedComparison, "matches_expected");
  assert.equal(pgenExecution.outcome, "pass");
  assert.deepEqual(pgenExecution.supportingChecks, [
    {
      checkId: "apply_gate_defense_in_depth",
      status: "passed",
      failureClass: null,
      notes: "firstFailingGate=basis",
    },
  ]);
  assert.equal(
    pgenExecution.pinnedCallInputs.some(
      (input) =>
        input.includes("qualifyCalibrationImageBasis") ||
        input.includes("inspectImageMetadata") ||
        input.includes("computeCalibrationImageFingerprint")
    ),
    false
  );
  assert.equal(
    pgenExecution.artifactReferences.includes("primary_call_fetch_boundary:none"),
    true
  );
  assert.match(
    pgenExecution.manualObservationLog,
    /All byte access occurred solely in resolver provenance verification/
  );
  for (const forbidden of [
    "evaluator",
    "capability",
    "metric",
    "authority_label",
    "external_reference",
  ]) {
    assert.equal(
      pgenExecution.manualObservationLog.toLowerCase().includes(forbidden),
      false
    );
  }

  const pgenRunMetadata = await buildNonPStaleRunMetadata({
    minimalInput: buildMinimalInput(),
    provenance: pgenProvenance,
  });
  const pgenRecord = buildNonPStaleObservedRunRecord({
    probeId: "P-gen",
    provenance: pgenProvenance,
    runMetadata: pgenRunMetadata,
    execution: pgenExecution,
  });
  assert.deepEqual(
    await validateG0ObservedRunRecord({
      fixtureReceipt: pgenProvenance.fixtureReceipt,
      record: pgenRecord,
    }),
    { ok: true }
  );
  const persistedText = JSON.stringify(pgenRecord).toLowerCase();
  for (const forbidden of [
    "evaluator",
    "capability",
    "metric",
    "authority_label",
    "external_reference",
  ]) {
    assert.equal(persistedText.includes(forbidden), false);
  }

  assert.equal(pgenProvenance.evaluatedImageDigest, G0_SYNTHETIC_ASSETS["A-gen"].sha256);
  assert.equal(pgenProvenance.payloadIdentity, null);
  assert.equal(pgenProvenance.payloadDigest, null);
  assert.equal(pgenProvenance.driftImageDigest, null);
  assert.equal(
    pgenProvenance.artifactReferences.some((entry) => entry.endsWith("/A-gen.jpg")),
    true
  );
  assert.equal(
    pgenProvenance.artifactReferences.includes(
      `fixture_image_digest:${G0_SYNTHETIC_ASSETS["A-gen"].sha256}`
    ),
    true
  );
  assert.deepEqual(
    pgenRecord.noAuthorityChecks.map((check) => `${check.checkId}:${check.status}`),
    [
      "qualification_refusal_result:pass",
      "restore_or_import_result:not_run",
      "route_response_result:not_run",
      "apply_gate_defense_in_depth:pass",
      "client_discard_predicate:not_run",
      "live_snapshot_state_observation:not_run",
      "state_transition_predicate:not_run",
    ]
  );

  const legacyProvenance = await resolveNonPStaleProvenance("P-legacy");
  const legacyExecution = await runDeterministicFirstSliceExecution({
    probeId: "P-legacy",
    provenance: legacyProvenance,
  });
  assert.equal(legacyExecution.mode, "deterministic_execution_observed");
  assert.equal(legacyExecution.emittedResult, "basis_legacy_receipt_missing");
  assert.deepEqual(
    legacyExecution.supportingChecks.map((check) => check.checkId),
    ["defensive_apply_gate_check"]
  );
  assert.equal(
    legacyExecution.supportingChecks.some((check) => check.checkId === "apply_gate_defense_in_depth"),
    false
  );

  const coordinateProvenance = await resolveNonPStaleProvenance("P-coordinate-space-drift");
  const coordinateExecution = await runDeterministicFirstSliceExecution({
    probeId: "P-coordinate-space-drift",
    provenance: coordinateProvenance,
  });
  assert.equal(coordinateExecution.mode, "deterministic_execution_observed");
  assert.equal(coordinateExecution.emittedResult, "basis_coordinate_space_mismatch");
  assert.deepEqual(
    coordinateExecution.supportingChecks.map((check) => check.checkId).sort(),
    ["apply_gate_defense_in_depth", "qualification_equality_key_check"]
  );

  const legacyRunMetadata = await buildNonPStaleRunMetadata({
    minimalInput: buildMinimalInput(),
    provenance: legacyProvenance,
  });
  const legacyRecord = buildNonPStaleObservedRunRecord({
    probeId: "P-legacy",
    provenance: legacyProvenance,
    runMetadata: legacyRunMetadata,
    execution: legacyExecution,
  });
  assert.equal(
    countExact(
      legacyRecord.artifactReferences,
      `payload_identity:${G0_PAYLOAD_FIXTURES["P-legacy"].payloadIdentity}`
    ),
    1
  );
  assert.equal(
    countExact(
      legacyRecord.artifactReferences,
      `payload_digest:${G0_PAYLOAD_FIXTURES["P-legacy"].payloadDigest}`
    ),
    1
  );

  const coordinateRunMetadata = await buildNonPStaleRunMetadata({
    minimalInput: buildMinimalInput(),
    provenance: coordinateProvenance,
  });
  const coordinateRecord = buildNonPStaleObservedRunRecord({
    probeId: "P-coordinate-space-drift",
    provenance: coordinateProvenance,
    runMetadata: coordinateRunMetadata,
    execution: coordinateExecution,
  });
  assert.equal(
    countExact(
      coordinateRecord.artifactReferences,
      `payload_identity:${G0_PAYLOAD_FIXTURES["P-coordinate-space-drift"].payloadIdentity}`
    ),
    1
  );
  assert.equal(
    countExact(
      coordinateRecord.artifactReferences,
      `payload_digest:${G0_PAYLOAD_FIXTURES["P-coordinate-space-drift"].payloadDigest}`
    ),
    1
  );
});

test("P-gen resolver binding and deterministic adapter fail closed on provenance drift", async () => {
  const provenance = await resolveNonPStaleProvenance("P-gen");
  assert.equal(provenance.probeId, "P-gen");
  assert.equal(provenance.evaluatedImageDigest, G0_SYNTHETIC_ASSETS["A-gen"].sha256);
  assert.equal(
    provenance.canonicalRepoRelativePaths.some((entry) => entry.endsWith("/A-gen.jpg")),
    true
  );
  assert.equal(
    provenance.fixtureReceipt.expectedRefusalOrContainmentResult,
    "basis_derivative_not_authority_eligible"
  );
  assert.equal(
    provenance.fixtureReceipt.expectedPipelineStage,
    "server basis evidence evaluation"
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-gen",
      provenance: {
        ...provenance,
        probeId: "P-empty",
      } as any,
    }),
    /unexpected_provenance_probe:P-gen:P-empty/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-gen",
      provenance: {
        ...provenance,
        evaluatedImageDigest: G0_SYNTHETIC_ASSETS["A-empty"].sha256,
      },
    }),
    /provenance_digest_drift:P-gen/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-gen",
      provenance: {
        ...provenance,
        canonicalRepoRelativePaths: ["app/admin/3d-room-lab/g0-containment/synthetic-assets/A-empty.jpg"],
      },
    }),
    /canonical_a_gen_path_missing:P-gen/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-gen",
      provenance: {
        ...provenance,
        fixtureReceipt: {
          ...provenance.fixtureReceipt,
          expectedRefusalOrContainmentResult: "basis_dimension_mismatch",
        },
      },
    }),
    /declaration_expected_result_mismatch:P-gen/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-gen",
      provenance: {
        ...provenance,
        fixtureReceipt: {
          ...provenance.fixtureReceipt,
          expectedPipelineStage: "restore image-basis receipt comparison",
        },
      },
    }),
    /declaration_expected_stage_mismatch:P-gen/
  );
});

test("P-dimension resolver binding and deterministic adapter fail closed on provenance drift", async () => {
  const provenance = await resolveNonPStaleProvenance("P-dimension-mismatch");
  assert.equal(provenance.probeId, "P-dimension-mismatch");
  assert.equal(provenance.evaluatedImageDigest, G0_SYNTHETIC_ASSETS["A-parent"].sha256);
  assert.equal(
    provenance.canonicalRepoRelativePaths.some((entry) => entry.endsWith("/A-parent.jpg")),
    true
  );
  assert.equal(provenance.fixtureReceipt.expectedRefusalOrContainmentResult, "basis_dimension_mismatch");
  assert.equal(provenance.fixtureReceipt.expectedPipelineStage, "server basis evidence evaluation");

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-dimension-mismatch",
      provenance: {
        ...provenance,
        probeId: "P-empty",
      } as any,
    }),
    /unexpected_provenance_probe:P-dimension-mismatch:P-empty/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-dimension-mismatch",
      provenance: {
        ...provenance,
        evaluatedImageDigest: G0_SYNTHETIC_ASSETS["A-empty"].sha256,
      },
    }),
    /provenance_digest_drift:P-dimension-mismatch/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-dimension-mismatch",
      provenance: {
        ...provenance,
        canonicalRepoRelativePaths: ["app/admin/3d-room-lab/g0-containment/synthetic-assets/A-empty.jpg"],
      },
    }),
    /canonical_a_parent_path_missing:P-dimension-mismatch/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-dimension-mismatch",
      provenance: {
        ...provenance,
        payloadIdentity: "unexpected",
      },
    }),
    /payload_fields_must_be_null:P-dimension-mismatch/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-dimension-mismatch",
      provenance: {
        ...provenance,
        driftImageDigest: G0_SYNTHETIC_ASSETS["A-drift-b"].sha256,
      },
    }),
    /drift_digest_must_be_null:P-dimension-mismatch/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-dimension-mismatch",
      provenance: {
        ...provenance,
        fixtureReceipt: {
          ...provenance.fixtureReceipt,
          expectedRefusalOrContainmentResult: "basis_derivative_not_authority_eligible",
        },
      },
    }),
    /declaration_expected_result_mismatch:P-dimension-mismatch/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-dimension-mismatch",
      provenance: {
        ...provenance,
        fixtureReceipt: {
          ...provenance.fixtureReceipt,
          expectedPipelineStage: "restore image-basis receipt comparison",
        },
      },
    }),
    /declaration_expected_stage_mismatch:P-dimension-mismatch/
  );
});

test("P-gen metadata references fail closed and do not cross fetch boundary", async () => {
  const provenance = await resolveNonPStaleProvenance("P-gen");
  const dimensionsReference = provenance.artifactReferences.find((entry) =>
    entry.startsWith("fixture_image_dimensions:")
  );
  const orientationReference = provenance.artifactReferences.find((entry) =>
    entry.startsWith("fixture_image_orientation:")
  );
  assert.ok(dimensionsReference);
  assert.ok(orientationReference);

  async function expectMetadataReject(
    artifactReferences: readonly string[],
    errorPattern: RegExp
  ): Promise<void> {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
        fetchCalls += 1;
        throw new Error("fetch_must_not_be_invoked");
      }) as typeof globalThis.fetch;
      await assert.rejects(
        runDeterministicFirstSliceExecution({
          probeId: "P-gen",
          provenance: { ...provenance, artifactReferences: [...artifactReferences] },
        }),
        errorPattern
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(fetchCalls, 0);
  }

  let successFetchCalls = 0;
  const originalFetch = globalThis.fetch;
  const validExecution = await (async () => {
    try {
      globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
        successFetchCalls += 1;
        throw new Error("fetch_must_not_be_invoked");
      }) as typeof globalThis.fetch;
      return runDeterministicFirstSliceExecution({
        probeId: "P-gen",
        provenance: {
          ...provenance,
          artifactReferences: [...provenance.artifactReferences],
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  })();
  assert.equal(validExecution.emittedResult, "basis_derivative_not_authority_eligible");
  assert.equal(successFetchCalls, 0);

  await expectMetadataReject(
    removeReferencesWithPrefix(provenance.artifactReferences, "fixture_image_dimensions:"),
    /missing_fixture_image_dimensions_reference:P-gen/
  );
  await expectMetadataReject(
    removeReferencesWithPrefix(provenance.artifactReferences, "fixture_image_orientation:"),
    /missing_fixture_image_orientation_reference:P-gen/
  );
  await expectMetadataReject(
    replaceFirstExact(
      provenance.artifactReferences,
      dimensionsReference!,
      "fixture_image_dimensions:0x240"
    ),
    /malformed_fixture_image_dimensions_reference:P-gen/
  );
  await expectMetadataReject(
    replaceFirstExact(provenance.artifactReferences, orientationReference!, "fixture_image_orientation:0"),
    /malformed_fixture_image_orientation_reference:P-gen/
  );
  await expectMetadataReject(
    [...provenance.artifactReferences, dimensionsReference!],
    /duplicate_fixture_image_dimensions_reference:P-gen/
  );
  await expectMetadataReject(
    [...provenance.artifactReferences, "fixture_image_dimensions:999x777"],
    /duplicate_fixture_image_dimensions_reference:P-gen/
  );
  await expectMetadataReject(
    [...provenance.artifactReferences, orientationReference!],
    /duplicate_fixture_image_orientation_reference:P-gen/
  );
  await expectMetadataReject(
    [...provenance.artifactReferences, "fixture_image_orientation:7"],
    /duplicate_fixture_image_orientation_reference:P-gen/
  );
  await expectMetadataReject(
    replaceFirstExact(
      provenance.artifactReferences,
      dimensionsReference!,
      "fixture_image_dimensions:321x241"
    ),
    /resolver_bound_metadata_mismatch:P-gen/
  );
  await expectMetadataReject(
    replaceFirstExact(provenance.artifactReferences, orientationReference!, "fixture_image_orientation:2"),
    /resolver_bound_metadata_mismatch:P-gen/
  );
  await expectMetadataReject(
    replaceFirstExact(
      provenance.artifactReferences,
      dimensionsReference!,
      `${dimensionsReference!}junk`
    ),
    /malformed_fixture_image_dimensions_reference:P-gen/
  );
  await expectMetadataReject(
    replaceFirstExact(
      provenance.artifactReferences,
      orientationReference!,
      `${orientationReference!}extra`
    ),
    /malformed_fixture_image_orientation_reference:P-gen/
  );
});

test("P-dimension deterministic chain is route-backed supporting evidence with exact checks and profile", async () => {
  const provenance = await resolveNonPStaleProvenance("P-dimension-mismatch");
  const execution = await runDeterministicFirstSliceExecution({
    probeId: "P-dimension-mismatch",
    provenance,
  });
  assert.equal(execution.mode, "deterministic_execution_observed");
  assert.equal(execution.emittedResult, "basis_dimension_mismatch");
  assert.equal(execution.expectedVsObservedComparison, "matches_expected");
  assert.equal(execution.outcome, "pass");
  assert.deepEqual(
    execution.supportingChecks.map((check) => ({
      checkId: check.checkId,
      status: check.status,
      failureClass: check.failureClass,
    })),
    [
      {
        checkId: "vision_route_pre_model_dimension_verification",
        status: "passed",
        failureClass: null,
      },
      {
        checkId: "apply_gate_defense_in_depth",
        status: "passed",
        failureClass: null,
      },
    ]
  );
  assert.match(
    execution.supportingChecks[0].notes ?? "",
    /route_response_result records whether the route response body carried the probe's declared containment token/
  );
  assert.equal(
    execution.artifactReferences.includes("primary_call_fetch_boundary:none"),
    true
  );
  assert.equal(
    execution.artifactReferences.includes("route_supporting_fetch_boundary:loopback_127.0.0.1_3000_only"),
    true
  );
  assert.equal(
    execution.artifactReferences.includes("route_served_request_path:/A-parent.jpg"),
    true
  );
  assert.equal(
    execution.artifactReferences.includes("route_failure_reason_kind:prose_not_containment_token"),
    true
  );
  assert.equal(
    execution.artifactReferences.includes("model_boundary:tripwire_installed_not_reached"),
    true
  );
  assert.equal(
    execution.pinnedCallInputs.some((value) =>
      value.includes(
        "evaluateCalibrationImageBasisEvidence:basisKind=original,browserDimensions=319x240"
      )
    ),
    true
  );
  assert.equal(
    execution.pinnedCallInputs.some((value) =>
      value.includes(
        "route.POST:detect-vision,inProcess=true,imageUrl=loopback:/A-parent.jpg,intrinsicSize=319x240"
      )
    ),
    true
  );
  assert.match(
    execution.manualObservationLog,
    /returned prose rather than the containment token/
  );

  const runMetadata = await buildNonPStaleRunMetadata({
    minimalInput: buildMinimalInput(),
    provenance,
  });
  const record = buildNonPStaleObservedRunRecord({
    probeId: "P-dimension-mismatch",
    provenance,
    runMetadata,
    execution,
  });
  assert.deepEqual(
    await validateG0ObservedRunRecord({
      fixtureReceipt: provenance.fixtureReceipt,
      record,
    }),
    { ok: true }
  );
  assert.deepEqual(
    record.supportingHarnessChecks.map((check) => `${check.checkId}:${check.required}:${check.status}`),
    [
      "vision_route_pre_model_dimension_verification:true:passed",
      "apply_gate_defense_in_depth:true:passed",
    ]
  );
  assert.deepEqual(
    record.noAuthorityChecks.map((check) => `${check.checkId}:${check.status}`),
    [
      "qualification_refusal_result:pass",
      "restore_or_import_result:not_run",
      "route_response_result:not_run",
      "apply_gate_defense_in_depth:pass",
      "client_discard_predicate:not_run",
      "live_snapshot_state_observation:not_run",
      "state_transition_predicate:not_run",
    ]
  );
  assert.deepEqual(record.primaryObservation.rawObservationReferences, []);
  const persistedText = JSON.stringify(record).toLowerCase();
  for (const forbidden of [
    "evaluator",
    "capability",
    "metric",
    "authority_label",
    "external_reference",
  ]) {
    assert.equal(persistedText.includes(forbidden), false);
  }
});

test("P-dimension strict metadata references fail closed and preserve P-gen strictness", async () => {
  const provenance = await resolveNonPStaleProvenance("P-dimension-mismatch");
  const dimensionsReference = provenance.artifactReferences.find((entry) =>
    entry.startsWith("fixture_image_dimensions:")
  );
  const orientationReference = provenance.artifactReferences.find((entry) =>
    entry.startsWith("fixture_image_orientation:")
  );
  assert.ok(dimensionsReference);
  assert.ok(orientationReference);

  async function expectMetadataReject(
    artifactReferences: readonly string[],
    errorPattern: RegExp
  ): Promise<void> {
    await assert.rejects(
      runDeterministicFirstSliceExecution({
        probeId: "P-dimension-mismatch",
        provenance: { ...provenance, artifactReferences: [...artifactReferences] },
      }),
      errorPattern
    );
  }

  await expectMetadataReject(
    removeReferencesWithPrefix(provenance.artifactReferences, "fixture_image_dimensions:"),
    /missing_fixture_image_dimensions_reference:P-dimension-mismatch/
  );
  await expectMetadataReject(
    removeReferencesWithPrefix(provenance.artifactReferences, "fixture_image_orientation:"),
    /missing_fixture_image_orientation_reference:P-dimension-mismatch/
  );
  await expectMetadataReject(
    replaceFirstExact(
      provenance.artifactReferences,
      dimensionsReference!,
      "fixture_image_dimensions:0x240"
    ),
    /malformed_fixture_image_dimensions_reference:P-dimension-mismatch/
  );
  await expectMetadataReject(
    replaceFirstExact(provenance.artifactReferences, orientationReference!, "fixture_image_orientation:0"),
    /malformed_fixture_image_orientation_reference:P-dimension-mismatch/
  );
  await expectMetadataReject(
    [...provenance.artifactReferences, dimensionsReference!],
    /duplicate_fixture_image_dimensions_reference:P-dimension-mismatch/
  );
  await expectMetadataReject(
    [...provenance.artifactReferences, "fixture_image_dimensions:999x777"],
    /duplicate_fixture_image_dimensions_reference:P-dimension-mismatch/
  );
  await expectMetadataReject(
    [...provenance.artifactReferences, orientationReference!],
    /duplicate_fixture_image_orientation_reference:P-dimension-mismatch/
  );
  await expectMetadataReject(
    [...provenance.artifactReferences, "fixture_image_orientation:7"],
    /duplicate_fixture_image_orientation_reference:P-dimension-mismatch/
  );
  await expectMetadataReject(
    replaceFirstExact(
      provenance.artifactReferences,
      dimensionsReference!,
      "fixture_image_dimensions:321x241"
    ),
    /resolver_bound_metadata_mismatch:P-dimension-mismatch/
  );
  await expectMetadataReject(
    replaceFirstExact(provenance.artifactReferences, orientationReference!, "fixture_image_orientation:2"),
    /resolver_bound_metadata_mismatch:P-dimension-mismatch/
  );
  await expectMetadataReject(
    replaceFirstExact(
      provenance.artifactReferences,
      dimensionsReference!,
      `${dimensionsReference!}junk`
    ),
    /malformed_fixture_image_dimensions_reference:P-dimension-mismatch/
  );
  await expectMetadataReject(
    replaceFirstExact(
      provenance.artifactReferences,
      orientationReference!,
      `${orientationReference!}extra`
    ),
    /malformed_fixture_image_orientation_reference:P-dimension-mismatch/
  );
});

const X4_ROUTE_RESPONSE_CLARIFICATION =
  "route_response_result records whether the route response body carried the probe's declared containment token. It remains not_run when a route supporting branch returns prose rather than that declared token.";

test("X4 deterministic chain emits exact orientation token with exact supporting checks and profile", async () => {
  const provenance = await resolveNonPStaleProvenance("X4");
  assert.equal(provenance.probeId, "X4");
  assert.equal(provenance.evaluatedImageDigest, G0_SYNTHETIC_ASSETS["A-exif"].sha256);
  assert.equal(
    provenance.evaluatedImageDigest,
    "26d09c2e02a9c05a02d0684a1cc6a509aa6cb037e83f0e09c23e4da8b1aab859"
  );
  assert.equal(provenance.fixtureReceipt.fixtureVersion, "g0/X4/v1");
  assert.equal(
    provenance.fixtureReceipt.expectedRefusalOrContainmentResult,
    "basis_orientation_not_normal"
  );
  assert.equal(provenance.fixtureReceipt.expectedPipelineStage, "server basis evidence evaluation");

  const execution = await runDeterministicFirstSliceExecution({
    probeId: "X4",
    provenance,
  });
  assert.equal(execution.mode, "deterministic_execution_observed");
  assert.equal(execution.emittedResult, "basis_orientation_not_normal");
  assert.equal(execution.expectedVsObservedComparison, "matches_expected");
  assert.equal(execution.outcome, "pass");
  assert.deepEqual(
    execution.supportingChecks.map((check) => ({
      checkId: check.checkId,
      status: check.status,
      failureClass: check.failureClass,
    })),
    [
      {
        checkId: "vision_route_pre_model_orientation_refusal",
        status: "passed",
        failureClass: null,
      },
      {
        checkId: "apply_gate_defense_in_depth",
        status: "passed",
        failureClass: null,
      },
    ]
  );
  assert.equal(execution.supportingChecks[0].notes, X4_ROUTE_RESPONSE_CLARIFICATION);
  assert.equal(execution.supportingChecks[1].notes, "firstFailingGate=basis");

  assert.equal(
    execution.artifactReferences.includes(
      "canonical_image_path:app/admin/3d-room-lab/g0-containment/synthetic-assets/A-exif.jpg"
    ),
    true
  );
  assert.equal(execution.artifactReferences.includes("primary_call_fetch_boundary:none"), true);
  assert.equal(
    execution.artifactReferences.includes(
      "route_supporting_fetch_boundary:loopback_127.0.0.1_3000_only"
    ),
    true
  );
  assert.equal(
    execution.artifactReferences.includes("route_served_request_path:/A-exif.jpg"),
    true
  );
  assert.equal(
    execution.artifactReferences.includes(
      "route_attested_basis_fingerprint:26d09c2e02a9c05a02d0684a1cc6a509aa6cb037e83f0e09c23e4da8b1aab859"
    ),
    true
  );
  assert.equal(
    execution.artifactReferences.includes("route_failure_reason_kind:prose_not_containment_token"),
    true
  );
  assert.equal(
    execution.artifactReferences.includes("model_boundary:tripwire_installed_not_reached"),
    true
  );
  assert.equal(
    execution.pinnedCallInputs.includes(
      "evaluateCalibrationImageBasisEvidence:basisKind=original,browserDimensions=null,coordinateSpace=sharp-metadata/v1,metadata=320x240/orientation=6"
    ),
    true
  );
  assert.equal(
    execution.pinnedCallInputs.includes(
      "route.POST:detect-vision,inProcess=true,imageUrl=loopback:/A-exif.jpg,frameSize=320x240,intrinsicSize=320x240,expectedBasisFingerprint=26d09c2e02a9c05a02d0684a1cc6a509aa6cb037e83f0e09c23e4da8b1aab859"
    ),
    true
  );
  assert.equal(
    execution.pinnedCallInputs.includes(
      "evaluateCalibratedCameraApply:basisQualified=false,basisUnavailableReason=basis_orientation_not_normal"
    ),
    true
  );
  assert.match(
    execution.manualObservationLog,
    /refused on non-normal EXIF orientation before the dimension comparison and before model execution/
  );
  assert.match(execution.manualObservationLog, /browserDimensions=null and did not read image bytes/);
  assert.match(execution.manualObservationLog, /returning prose rather than the containment token/);
  assert.match(execution.manualObservationLog, /The model tripwire was installed and never reached/);

  const runMetadata = await buildNonPStaleRunMetadata({
    minimalInput: buildMinimalInput(),
    provenance,
  });
  const record = buildNonPStaleObservedRunRecord({
    probeId: "X4",
    provenance,
    runMetadata,
    execution,
  });
  assert.deepEqual(
    await validateG0ObservedRunRecord({
      fixtureReceipt: provenance.fixtureReceipt,
      record,
    }),
    { ok: true }
  );
  assert.deepEqual(
    record.supportingHarnessChecks.map(
      (check) => `${check.checkId}:${check.required}:${check.status}`
    ),
    [
      "vision_route_pre_model_orientation_refusal:true:passed",
      "apply_gate_defense_in_depth:true:passed",
    ]
  );
  assert.equal(
    record.supportingHarnessChecks[0].notes,
    X4_ROUTE_RESPONSE_CLARIFICATION
  );
  assert.deepEqual(
    record.noAuthorityChecks.map((check) => `${check.checkId}:${check.status}`),
    [
      "qualification_refusal_result:pass",
      "restore_or_import_result:not_run",
      "route_response_result:not_run",
      "apply_gate_defense_in_depth:pass",
      "client_discard_predicate:not_run",
      "live_snapshot_state_observation:not_run",
      "state_transition_predicate:not_run",
    ]
  );
  assert.equal(record.primaryObservation.observationKind, "emitted_application_result");
  assert.equal(record.primaryObservation.observedPipelineStage, "server basis evidence evaluation");
  assert.equal(record.primaryObservation.observedOperationalState, "calibration_not_attempted");
  assert.equal(record.primaryObservation.derivedContainmentConclusion, null);
  assert.deepEqual(record.primaryObservation.rawObservationReferences, []);
  assert.equal(record.incidentReference, null);

  assert.equal(
    record.artifactReferences.includes(
      "fixture_image_path:app/admin/3d-room-lab/g0-containment/synthetic-assets/A-exif.jpg"
    ),
    true
  );
  assert.equal(
    record.artifactReferences.includes(
      "fixture_image_digest:26d09c2e02a9c05a02d0684a1cc6a509aa6cb037e83f0e09c23e4da8b1aab859"
    ),
    true
  );
  assert.equal(record.artifactReferences.includes("fixture_image_dimensions:320x240"), true);
  assert.equal(record.artifactReferences.includes("fixture_image_orientation:6"), true);
  assert.equal(
    record.artifactReferences.includes("execution_mode:deterministic_execution_observed"),
    true
  );
  assert.equal(
    new Set(record.artifactReferences).size,
    record.artifactReferences.length
  );

  const persistedText = JSON.stringify(record).toLowerCase();
  for (const forbidden of [
    "evaluator",
    "capability",
    "metric",
    "authority_label",
    "external_reference",
  ]) {
    assert.equal(persistedText.includes(forbidden), false);
  }
});

test("X4 basis-evidence preemption order and orientation positive control are deterministic", () => {
  const x4Primary = evaluateCalibrationImageBasisEvidence({
    basisKind: "original",
    browserDimensions: null,
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    metadata: {
      width: X4_PINNED_MATCHING_DIMENSIONS.width,
      height: X4_PINNED_MATCHING_DIMENSIONS.height,
      orientation: 6,
    },
  });
  assert.equal(x4Primary.ok, false);
  if (x4Primary.ok) {
    throw new Error("unexpected_x4_primary_shape");
  }
  assert.equal(x4Primary.reason, "basis_orientation_not_normal");

  const coordinateSpacePreemption = evaluateCalibrationImageBasisEvidence({
    basisKind: "original",
    browserDimensions: null,
    coordinateSpaceVersion: {
      ...CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
      decoderId: "sharp-metadata/v0",
    },
    metadata: { width: 320, height: 240, orientation: 6 },
  });
  assert.equal(coordinateSpacePreemption.ok, false);
  if (coordinateSpacePreemption.ok) {
    throw new Error("unexpected_coordinate_space_preemption_shape");
  }
  assert.equal(coordinateSpacePreemption.reason, "basis_coordinate_space_mismatch");

  const derivativePreemption = evaluateCalibrationImageBasisEvidence({
    basisKind: "derivative",
    browserDimensions: null,
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    metadata: { width: 320, height: 240, orientation: 6 },
  });
  assert.equal(derivativePreemption.ok, false);
  if (derivativePreemption.ok) {
    throw new Error("unexpected_derivative_preemption_shape");
  }
  assert.equal(derivativePreemption.reason, "basis_derivative_not_authority_eligible");

  const normalOrientationControl = evaluateCalibrationImageBasisEvidence({
    basisKind: "original",
    browserDimensions: null,
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    metadata: { width: 320, height: 240, orientation: 1 },
  });
  assert.deepEqual(normalOrientationControl, { ok: true });
});

test("X4 resolver binding and deterministic adapter fail closed on provenance drift", async () => {
  const provenance = await resolveNonPStaleProvenance("X4");

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "X4",
      provenance: {
        ...provenance,
        probeId: "P-empty",
      } as any,
    }),
    /unexpected_provenance_probe:X4:P-empty/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "X4",
      provenance: {
        ...provenance,
        evaluatedImageDigest: G0_SYNTHETIC_ASSETS["A-parent"].sha256,
      },
    }),
    /provenance_digest_drift:X4/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "X4",
      provenance: {
        ...provenance,
        canonicalRepoRelativePaths: [
          "app/admin/3d-room-lab/g0-containment/synthetic-assets/A-parent.jpg",
        ],
      },
    }),
    /canonical_a_exif_path_missing:X4/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "X4",
      provenance: {
        ...provenance,
        payloadIdentity: "unexpected",
      },
    }),
    /payload_fields_must_be_null:X4/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "X4",
      provenance: {
        ...provenance,
        driftImageDigest: G0_SYNTHETIC_ASSETS["A-drift-b"].sha256,
      },
    }),
    /drift_digest_must_be_null:X4/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "X4",
      provenance: {
        ...provenance,
        fixtureReceipt: {
          ...provenance.fixtureReceipt,
          expectedRefusalOrContainmentResult: "basis_dimension_mismatch",
        },
      },
    }),
    /declaration_expected_result_mismatch:X4/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "X4",
      provenance: {
        ...provenance,
        fixtureReceipt: {
          ...provenance.fixtureReceipt,
          expectedPipelineStage: "restore image-basis receipt comparison",
        },
      },
    }),
    /declaration_expected_stage_mismatch:X4/
  );
});

test("X4 strict metadata references fail closed on missing, malformed, duplicate, mismatch, and suffix junk", async () => {
  const provenance = await resolveNonPStaleProvenance("X4");
  const dimensionsReference = provenance.artifactReferences.find((entry) =>
    entry.startsWith("fixture_image_dimensions:")
  );
  const orientationReference = provenance.artifactReferences.find((entry) =>
    entry.startsWith("fixture_image_orientation:")
  );
  assert.ok(dimensionsReference);
  assert.ok(orientationReference);
  assert.equal(dimensionsReference, "fixture_image_dimensions:320x240");
  assert.equal(orientationReference, "fixture_image_orientation:6");

  async function expectMetadataReject(
    artifactReferences: readonly string[],
    errorPattern: RegExp
  ): Promise<void> {
    await assert.rejects(
      runDeterministicFirstSliceExecution({
        probeId: "X4",
        provenance: { ...provenance, artifactReferences: [...artifactReferences] },
      }),
      errorPattern
    );
  }

  await expectMetadataReject(
    removeReferencesWithPrefix(provenance.artifactReferences, "fixture_image_dimensions:"),
    /missing_fixture_image_dimensions_reference:X4/
  );
  await expectMetadataReject(
    removeReferencesWithPrefix(provenance.artifactReferences, "fixture_image_orientation:"),
    /missing_fixture_image_orientation_reference:X4/
  );
  await expectMetadataReject(
    replaceFirstExact(
      provenance.artifactReferences,
      dimensionsReference!,
      "fixture_image_dimensions:0x240"
    ),
    /malformed_fixture_image_dimensions_reference:X4/
  );
  await expectMetadataReject(
    replaceFirstExact(provenance.artifactReferences, orientationReference!, "fixture_image_orientation:0"),
    /malformed_fixture_image_orientation_reference:X4/
  );
  await expectMetadataReject(
    [...provenance.artifactReferences, dimensionsReference!],
    /duplicate_fixture_image_dimensions_reference:X4/
  );
  await expectMetadataReject(
    [...provenance.artifactReferences, "fixture_image_dimensions:999x777"],
    /duplicate_fixture_image_dimensions_reference:X4/
  );
  await expectMetadataReject(
    [...provenance.artifactReferences, orientationReference!],
    /duplicate_fixture_image_orientation_reference:X4/
  );
  await expectMetadataReject(
    [...provenance.artifactReferences, "fixture_image_orientation:7"],
    /duplicate_fixture_image_orientation_reference:X4/
  );
  await expectMetadataReject(
    replaceFirstExact(
      provenance.artifactReferences,
      dimensionsReference!,
      "fixture_image_dimensions:321x241"
    ),
    /resolver_bound_metadata_mismatch:X4/
  );
  await expectMetadataReject(
    replaceFirstExact(provenance.artifactReferences, orientationReference!, "fixture_image_orientation:2"),
    /resolver_bound_metadata_mismatch:X4/
  );
  await expectMetadataReject(
    replaceFirstExact(
      provenance.artifactReferences,
      dimensionsReference!,
      `${dimensionsReference!}junk`
    ),
    /malformed_fixture_image_dimensions_reference:X4/
  );
  await expectMetadataReject(
    replaceFirstExact(
      provenance.artifactReferences,
      orientationReference!,
      `${orientationReference!}extra`
    ),
    /malformed_fixture_image_orientation_reference:X4/
  );
});

const A_PARENT_SHA_LITERAL =
  "bd7ffe9c5e68fd5fce30faf94cafe57f5e0840ed74a03986f74d2526fc95e9c8";
const A_DRIFT_B_SHA_LITERAL =
  "dfddfdac51dca6ac42008699768d4decf5f7c29c09ac1f5f8b069e837cc5d572";

test("P-url-drift deterministic chain emits the exact restore token with exact supporting checks and profile", async () => {
  const provenance = await resolveNonPStaleProvenance("P-url-drift");
  assert.equal(provenance.probeId, "P-url-drift");
  assert.equal(provenance.evaluatedImageDigest, G0_SYNTHETIC_ASSETS["A-parent"].sha256);
  assert.equal(provenance.evaluatedImageDigest, A_PARENT_SHA_LITERAL);
  assert.equal(provenance.driftImageDigest, G0_SYNTHETIC_ASSETS["A-drift-b"].sha256);
  assert.equal(provenance.driftImageDigest, A_DRIFT_B_SHA_LITERAL);
  assert.equal(provenance.fixtureReceipt.fixtureVersion, "g0/P-url-drift/v1");
  assert.equal(
    provenance.fixtureReceipt.expectedRefusalOrContainmentResult,
    "basis_fingerprint_mismatch"
  );
  assert.equal(
    provenance.fixtureReceipt.expectedPipelineStage,
    "restore image-basis receipt comparison"
  );
  assert.equal(
    provenance.fixtureReceipt.sourceAssetIdentity.kind === "source_asset"
      ? provenance.fixtureReceipt.sourceAssetIdentity.sourceAssetId
      : null,
    "g0-source-P-url-drift"
  );
  assert.equal(
    provenance.fixtureReceipt.basisBinding.kind === "expected_basis_refusal" &&
      provenance.fixtureReceipt.basisBinding.sourceAssetIdentity.kind === "source_asset"
      ? provenance.fixtureReceipt.basisBinding.sourceAssetIdentity.sourceAssetId
      : null,
    "A-parent-asset"
  );

  const execution = await runDeterministicFirstSliceExecution({
    probeId: "P-url-drift",
    provenance,
  });
  assert.equal(execution.mode, "deterministic_execution_observed");
  assert.equal(execution.emittedResult, "basis_fingerprint_mismatch");
  assert.equal(execution.expectedVsObservedComparison, "matches_expected");
  assert.equal(execution.outcome, "pass");
  assert.deepEqual(
    execution.supportingChecks.map((check) => ({
      checkId: check.checkId,
      status: check.status,
      failureClass: check.failureClass,
    })),
    [
      {
        checkId: "vision_route_mismatch_discard",
        status: "passed",
        failureClass: null,
      },
      {
        checkId: "empty_room_route_mismatch_discard",
        status: "passed",
        failureClass: null,
      },
      {
        checkId: "client_discard_predicate",
        status: "passed",
        failureClass: null,
      },
      {
        checkId: "apply_gate_defense_in_depth",
        status: "passed",
        failureClass: null,
      },
    ]
  );
  assert.match(
    execution.supportingChecks[0].notes ?? "",
    /carried the literal declared token basis_fingerprint_mismatch/
  );
  assert.match(
    execution.supportingChecks[0].notes ?? "",
    /model tripwire was installed and never reached/
  );
  assert.match(
    execution.supportingChecks[1].notes ?? "",
    /blocked result state/
  );
  assert.match(
    execution.supportingChecks[1].notes ?? "",
    /generation and detection tripwires were installed and never reached/
  );
  assert.match(
    execution.supportingChecks[2].notes ?? "",
    /actual route-attested A-drift-b fingerprints/
  );
  assert.match(execution.supportingChecks[2].notes ?? "", /null-input controls/);
  assert.equal(execution.supportingChecks[3].notes, "firstFailingGate=basis");

  assert.equal(
    execution.artifactReferences.includes(
      "canonical_image_path:app/admin/3d-room-lab/g0-containment/synthetic-assets/A-parent.jpg"
    ),
    true
  );
  assert.equal(
    execution.artifactReferences.includes(
      "canonical_drift_image_path:app/admin/3d-room-lab/g0-containment/synthetic-assets/A-drift-b.jpg"
    ),
    true
  );
  assert.equal(execution.artifactReferences.includes("primary_call_fetch_boundary:none"), true);
  assert.equal(
    execution.artifactReferences.includes(
      "route_supporting_fetch_boundary:loopback_127.0.0.1_3000_only"
    ),
    true
  );
  assert.equal(
    execution.artifactReferences.includes("vision_route_served_request_path:/A-drift-b.jpg"),
    true
  );
  assert.equal(
    execution.artifactReferences.includes(
      "empty_room_route_served_request_path:/A-drift-b.jpg"
    ),
    true
  );
  assert.equal(
    execution.artifactReferences.includes(
      `expected_basis_fingerprint_sent:${A_PARENT_SHA_LITERAL}`
    ),
    true
  );
  assert.equal(
    execution.artifactReferences.includes(
      `vision_route_attested_basis_fingerprint:${A_DRIFT_B_SHA_LITERAL}`
    ),
    true
  );
  assert.equal(
    execution.artifactReferences.includes(
      `empty_room_route_attested_basis_fingerprint:${A_DRIFT_B_SHA_LITERAL}`
    ),
    true
  );
  assert.equal(
    execution.artifactReferences.includes("route_failure_reason_kind:declared_containment_token"),
    true
  );
  assert.equal(
    execution.artifactReferences.includes("model_boundary:tripwires_installed_not_reached"),
    true
  );

  assert.equal(
    execution.pinnedCallInputs.includes(
      `evaluateCalibrationRestoreCompatibility:persistedFingerprint=${A_PARENT_SHA_LITERAL},currentFingerprint=${A_DRIFT_B_SHA_LITERAL},dimensions=320x240,orientation=1,basisKind=original,coordinateSpace=sharp-metadata/v1,sourceImageUrl=${P_URL_DRIFT_PINNED_SOURCE_IMAGE_URL}`
    ),
    true
  );
  assert.equal(
    execution.pinnedCallInputs.includes(
      `route.POST:detect-vision,inProcess=true,imageUrl=loopback:/A-drift-b.jpg,frameSize=320x240,intrinsicSize=320x240,expectedBasisFingerprint=${A_PARENT_SHA_LITERAL}`
    ),
    true
  );
  assert.equal(
    execution.pinnedCallInputs.includes(
      `route.POST:empty-room-assist/run,inProcess=true,imageUrl=loopback:/A-drift-b.jpg,frameSize=320x240,intrinsicSize=320x240,expectedBasisFingerprint=${A_PARENT_SHA_LITERAL}`
    ),
    true
  );
  assert.equal(
    execution.pinnedCallInputs.includes(
      `shouldDiscardAttestedResponse:currentBasisFingerprint=${A_PARENT_SHA_LITERAL},attestedBasisFingerprint=${A_DRIFT_B_SHA_LITERAL}`
    ),
    true
  );
  assert.equal(
    execution.pinnedCallInputs.includes(
      "evaluateCalibratedCameraApply:basisQualified=false,basisUnavailableReason=basis_fingerprint_mismatch"
    ),
    true
  );

  assert.match(
    execution.manualObservationLog,
    /performed no fetch, decode, hash, fingerprint computation, or filesystem access/
  );
  assert.match(
    execution.manualObservationLog,
    /both route responses attested the A-drift-b digest/
  );
  assert.match(
    execution.manualObservationLog,
    /emits a console warning and performs no persistent write/
  );
  assert.match(
    execution.manualObservationLog,
    /installed and never reached during the mismatch observations/
  );

  const runMetadata = await buildNonPStaleRunMetadata({
    minimalInput: buildMinimalInput(),
    provenance,
  });
  const record = buildNonPStaleObservedRunRecord({
    probeId: "P-url-drift",
    provenance,
    runMetadata,
    execution,
  });
  assert.deepEqual(
    await validateG0ObservedRunRecord({
      fixtureReceipt: provenance.fixtureReceipt,
      record,
    }),
    { ok: true }
  );
  assert.deepEqual(
    record.supportingHarnessChecks.map(
      (check) => `${check.checkId}:${check.required}:${check.status}`
    ),
    [
      "vision_route_mismatch_discard:true:passed",
      "empty_room_route_mismatch_discard:true:passed",
      "client_discard_predicate:true:passed",
      "apply_gate_defense_in_depth:true:passed",
    ]
  );
  assert.deepEqual(
    record.noAuthorityChecks.map((check) => `${check.checkId}:${check.status}`),
    [
      "qualification_refusal_result:not_run",
      "restore_or_import_result:pass",
      "route_response_result:pass",
      "apply_gate_defense_in_depth:pass",
      "client_discard_predicate:pass",
      "live_snapshot_state_observation:not_run",
      "state_transition_predicate:not_run",
    ]
  );
  assert.equal(record.primaryObservation.observationKind, "emitted_application_result");
  assert.equal(
    record.primaryObservation.observedPipelineStage,
    "restore image-basis receipt comparison"
  );
  assert.equal(record.primaryObservation.observedOperationalState, "calibration_not_attempted");
  assert.equal(record.primaryObservation.outcome, "pass");
  assert.equal(record.primaryObservation.emittedResult, "basis_fingerprint_mismatch");
  assert.equal(record.primaryObservation.derivedContainmentConclusion, null);
  assert.deepEqual(record.primaryObservation.rawObservationReferences, []);
  assert.equal(record.incidentReference, null);
  assert.equal(record.runMetadata.runIdentity.basisFingerprint, A_PARENT_SHA_LITERAL);

  assert.equal(
    new Set(record.artifactReferences).size,
    record.artifactReferences.length
  );
  assert.equal(
    record.artifactReferences.includes("execution_mode:deterministic_execution_observed"),
    true
  );

  const persistedText = JSON.stringify(record).toLowerCase();
  for (const forbidden of [
    "evaluator",
    "capability",
    "metric",
    "authority_label",
    "external_reference",
  ]) {
    assert.equal(persistedText.includes(forbidden), false);
  }
});

test("P-url-drift restore-comparison primary token and preemption controls are deterministic", () => {
  const parentDigest = G0_SYNTHETIC_ASSETS["A-parent"].sha256;
  const driftDigest = G0_SYNTHETIC_ASSETS["A-drift-b"].sha256;
  assert.notEqual(parentDigest, driftDigest);

  const persistedCalibration = buildPurlDriftPersistedCalibration(parentDigest);
  assert.equal(
    persistedCalibration.source.imageBasis.sourceImageUrl,
    P_URL_DRIFT_PINNED_SOURCE_IMAGE_URL
  );
  assert.equal(
    persistedCalibration.source.imageBasis.decodedWidth,
    P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.width
  );
  assert.equal(
    persistedCalibration.source.imageBasis.decodedHeight,
    P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.height
  );
  assert.equal(persistedCalibration.source.imageBasis.encodedOrientation, 1);
  assert.equal(persistedCalibration.source.imageBasis.basisKind, "original");

  // Primary token exactness, obtained only from result.reason.
  const primary = evaluateCalibrationRestoreCompatibility({
    calibration: persistedCalibration,
    currentImageBasis: buildPurlDriftRestoreImageBasis(driftDigest),
  });
  assert.equal(primary.ok, false);
  if (primary.ok) {
    throw new Error("unexpected_primary_shape");
  }
  assert.equal(primary.reason, "basis_fingerprint_mismatch");

  // Unsupported calibration version preempts fingerprint.
  const versionPreemption = evaluateCalibrationRestoreCompatibility({
    calibration: {
      ...persistedCalibration,
      calibrationVersion: "calibrated-camera/v1",
    } as unknown as typeof persistedCalibration,
    currentImageBasis: buildPurlDriftRestoreImageBasis(driftDigest),
  });
  assert.equal(versionPreemption.ok, false);
  if (versionPreemption.ok) {
    throw new Error("unexpected_version_preemption_shape");
  }
  assert.equal(versionPreemption.reason, "unsupported calibration version");

  // Unsupported solver preempts fingerprint.
  const solverPreemption = evaluateCalibrationRestoreCompatibility({
    calibration: {
      ...persistedCalibration,
      solver: "homography-planar-cv/v0",
    } as unknown as typeof persistedCalibration,
    currentImageBasis: buildPurlDriftRestoreImageBasis(driftDigest),
  });
  assert.equal(solverPreemption.ok, false);
  if (solverPreemption.ok) {
    throw new Error("unexpected_solver_preemption_shape");
  }
  assert.equal(solverPreemption.reason, "unsupported solver");

  // Null current basis preempts fingerprint.
  const nullBasisPreemption = evaluateCalibrationRestoreCompatibility({
    calibration: persistedCalibration,
    currentImageBasis: null,
  });
  assert.equal(nullBasisPreemption.ok, false);
  if (nullBasisPreemption.ok) {
    throw new Error("unexpected_null_basis_preemption_shape");
  }
  assert.equal(nullBasisPreemption.reason, "basis_unavailable");

  // Equal fingerprints do not emit the token.
  const equalFingerprints = evaluateCalibrationRestoreCompatibility({
    calibration: persistedCalibration,
    currentImageBasis: buildPurlDriftRestoreImageBasis(parentDigest),
  });
  assert.deepEqual(equalFingerprints, { ok: true, aspectDeltaPercent: 0, warning: null });

  // Fingerprint mismatch emits before later dimension, orientation,
  // coordinate-space, and basis-kind differences.
  const laterAxesAlsoDiffer = evaluateCalibrationRestoreCompatibility({
    calibration: persistedCalibration,
    currentImageBasis: {
      ...buildPurlDriftRestoreImageBasis(driftDigest),
      decodedWidth: 640,
      decodedHeight: 480,
      encodedOrientation: 6,
      decodedOrientationNormal: false as unknown as true,
      coordinateSpaceVersion: {
        ...CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
        decoderId: "sharp-metadata/v0",
      },
      basisKind: "derivative",
    },
  });
  assert.equal(laterAxesAlsoDiffer.ok, false);
  if (laterAxesAlsoDiffer.ok) {
    throw new Error("unexpected_later_axes_shape");
  }
  assert.equal(laterAxesAlsoDiffer.reason, "basis_fingerprint_mismatch");

  // Client discard predicate consumes fingerprints and null controls stay false.
  assert.equal(shouldDiscardAttestedResponse(parentDigest, driftDigest), true);
  assert.equal(shouldDiscardAttestedResponse(null, driftDigest), false);
  assert.equal(shouldDiscardAttestedResponse(parentDigest, null), false);
  assert.equal(shouldDiscardAttestedResponse(null, null), false);
});

test("P-url-drift resolver binding and deterministic adapter fail closed on provenance drift", async () => {
  await withMutatedSyntheticAsset(
    "A-parent",
    (asset) => {
      asset.sha256 = "f".repeat(64);
    },
    async () => {
      await assert.rejects(resolveNonPStaleProvenance("P-url-drift"), /image_digest_drift/);
    }
  );
  await withMutatedSyntheticAsset(
    "A-drift-b",
    (asset) => {
      asset.sha256 = "0".repeat(64);
    },
    async () => {
      await assert.rejects(resolveNonPStaleProvenance("P-url-drift"), /image_digest_drift/);
    }
  );
  await withMutatedSyntheticAsset(
    "A-drift-b",
    (asset) => {
      asset.parentAssetId = null;
    },
    async () => {
      await assert.rejects(
        resolveNonPStaleProvenance("P-url-drift"),
        /registry_asset_parent_lineage_mismatch/
      );
    }
  );

  const provenance = await resolveNonPStaleProvenance("P-url-drift");

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-url-drift",
      provenance: {
        ...provenance,
        probeId: "P-empty",
      } as any,
    }),
    /unexpected_provenance_probe:P-url-drift:P-empty/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-url-drift",
      provenance: {
        ...provenance,
        evaluatedImageDigest: G0_SYNTHETIC_ASSETS["A-drift-b"].sha256,
      },
    }),
    /provenance_digest_drift:P-url-drift/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-url-drift",
      provenance: {
        ...provenance,
        driftImageDigest: G0_SYNTHETIC_ASSETS["A-parent"].sha256,
      },
    }),
    /drift_provenance_digest_drift:P-url-drift/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-url-drift",
      provenance: {
        ...provenance,
        driftImageDigest: null,
      },
    }),
    /drift_provenance_digest_drift:P-url-drift/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-url-drift",
      provenance: {
        ...provenance,
        payloadIdentity: "unexpected",
      },
    }),
    /payload_fields_must_be_null:P-url-drift/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-url-drift",
      provenance: {
        ...provenance,
        canonicalRepoRelativePaths: [
          "app/admin/3d-room-lab/g0-containment/synthetic-assets/A-drift-b.jpg",
        ],
      },
    }),
    /canonical_a_parent_path_missing:P-url-drift/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-url-drift",
      provenance: {
        ...provenance,
        canonicalRepoRelativePaths: [
          "app/admin/3d-room-lab/g0-containment/synthetic-assets/A-parent.jpg",
        ],
      },
    }),
    /canonical_a_drift_b_path_missing:P-url-drift/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-url-drift",
      provenance: {
        ...provenance,
        fixtureReceipt: {
          ...provenance.fixtureReceipt,
          expectedRefusalOrContainmentResult: "basis_dimension_mismatch",
        },
      },
    }),
    /declaration_expected_result_mismatch:P-url-drift/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-url-drift",
      provenance: {
        ...provenance,
        fixtureReceipt: {
          ...provenance.fixtureReceipt,
          expectedPipelineStage: "server basis evidence evaluation",
        },
      },
    }),
    /declaration_expected_stage_mismatch:P-url-drift/
  );
});

const A_CROP_SHA_LITERAL =
  "4aa5b69c28d49aef2847936fef9fe91a70be48b7e7f99f6f8063f37f7f4b60f2";

const P_CROP_RESTORE_COMPARISON_CLARIFICATION =
  "The resolver re-hashed A-crop and confirmed its digest differs from the registry-committed A-parent digest, with A-crop's registry lineage to A-parent enforced. A-parent bytes were not re-read. The pure comparison used A-parent as the persisted basis and A-crop as the current basis. Its observed result was basis_fingerprint_mismatch because fingerprint comparison precedes dimensions and basis-kind comparison. This supporting result verifies changed-byte crop containment ordering only; it is not the primary P-crop result and does not make restore_or_import_result a pass axis.";

test("P-crop deterministic chain emits the derivative refusal token with exact supporting checks and profile", async () => {
  const provenance = await resolveNonPStaleProvenance("P-crop");
  assert.equal(provenance.probeId, "P-crop");
  assert.equal(provenance.evaluatedImageDigest, G0_SYNTHETIC_ASSETS["A-crop"].sha256);
  assert.equal(provenance.evaluatedImageDigest, A_CROP_SHA_LITERAL);
  assert.equal(provenance.driftImageDigest, null);
  assert.equal(provenance.fixtureReceipt.fixtureVersion, "g0/P-crop/v1");
  assert.equal(
    provenance.fixtureReceipt.expectedRefusalOrContainmentResult,
    "basis_derivative_not_authority_eligible"
  );
  assert.equal(provenance.fixtureReceipt.expectedPipelineStage, "server basis evidence evaluation");
  assert.equal(
    provenance.artifactReferences.includes("fixture_image_dimensions:280x220"),
    true
  );
  assert.equal(
    provenance.artifactReferences.includes("fixture_image_orientation:1"),
    true
  );

  // The frozen seven-axis P-crop profile persists verbatim.
  assert.deepEqual(NON_P_STALE_NO_AUTHORITY_PROFILES["P-crop"], {
    qualification_refusal_result: "pass",
    restore_or_import_result: "not_run",
    route_response_result: "not_run",
    apply_gate_defense_in_depth: "pass",
    client_discard_predicate: "not_run",
    live_snapshot_state_observation: "not_run",
    state_transition_predicate: "not_run",
  });

  // The whole deterministic chain must cross no fetch boundary.
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  const execution = await (async () => {
    try {
      globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
        fetchCalls += 1;
        throw new Error("fetch_must_not_be_invoked");
      }) as typeof globalThis.fetch;
      return runDeterministicFirstSliceExecution({
        probeId: "P-crop",
        provenance,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  })();
  assert.equal(fetchCalls, 0);

  assert.equal(execution.mode, "deterministic_execution_observed");
  assert.equal(execution.emittedResult, "basis_derivative_not_authority_eligible");
  assert.equal(execution.expectedVsObservedComparison, "matches_expected");
  assert.equal(execution.outcome, "pass");
  assert.deepEqual(
    execution.supportingChecks.map((check) => ({
      checkId: check.checkId,
      status: check.status,
      failureClass: check.failureClass,
    })),
    [
      {
        checkId: "restore_comparison_changed_byte_crop",
        status: "passed",
        failureClass: null,
      },
      {
        checkId: "apply_gate_defense_in_depth",
        status: "passed",
        failureClass: null,
      },
    ]
  );
  assert.equal(execution.supportingChecks[0].notes, P_CROP_RESTORE_COMPARISON_CLARIFICATION);
  assert.equal(execution.supportingChecks[1].notes, "firstFailingGate=basis");

  assert.equal(
    execution.artifactReferences.includes(
      "canonical_image_path:app/admin/3d-room-lab/g0-containment/synthetic-assets/A-crop.jpg"
    ),
    true
  );
  assert.equal(execution.artifactReferences.includes("primary_call_fetch_boundary:none"), true);
  assert.equal(
    execution.artifactReferences.includes("restore_comparison_fetch_boundary:none"),
    true
  );
  assert.equal(execution.artifactReferences.includes("parent_registry_asset:A-parent"), true);
  assert.equal(
    execution.artifactReferences.includes(
      `parent_registry_image_digest:${A_PARENT_SHA_LITERAL}`
    ),
    true
  );
  assert.equal(
    execution.artifactReferences.includes("parent_registry_dimensions:320x240"),
    true
  );
  assert.equal(execution.artifactReferences.includes("parent_registry_orientation:1"), true);
  assert.equal(
    execution.artifactReferences.includes("parent_lineage:registry_enforced:A-crop:A-parent"),
    true
  );
  assert.equal(
    execution.artifactReferences.includes(
      `restore_comparison_persisted_registry_fingerprint:${A_PARENT_SHA_LITERAL}`
    ),
    true
  );
  assert.equal(
    execution.artifactReferences.includes(
      `restore_comparison_current_fingerprint:${A_CROP_SHA_LITERAL}`
    ),
    true
  );
  assert.equal(
    execution.artifactReferences.includes(
      "restore_comparison_observed_result:basis_fingerprint_mismatch"
    ),
    true
  );
  assert.equal(
    execution.artifactReferences.includes("apply_gate_first_failing_gate:basis"),
    true
  );
  // No parent file-path artifact: A-parent is registry-scoped only.
  assert.equal(
    execution.artifactReferences.some(
      (entry) => entry.startsWith("parent_image_path:") || entry.includes("/A-parent.jpg")
    ),
    false
  );

  assert.equal(
    execution.pinnedCallInputs.includes(
      "evaluateCalibrationImageBasisEvidence:basisKind=derivative,browserDimensions=null,coordinateSpace=sharp-metadata/v1,metadata=280x220/orientation=1"
    ),
    true
  );
  assert.equal(
    execution.pinnedCallInputs.includes(
      `evaluateCalibrationRestoreCompatibility:persistedFingerprint=${A_PARENT_SHA_LITERAL},persistedDimensions=320x240,persistedBasisKind=original,currentFingerprint=${A_CROP_SHA_LITERAL},currentDimensions=280x220,currentBasisKind=derivative,orientation=1,coordinateSpace=sharp-metadata/v1,sourceImageUrl=${P_CROP_PINNED_SOURCE_IMAGE_URL}`
    ),
    true
  );
  assert.equal(
    execution.pinnedCallInputs.includes(
      "evaluateCalibratedCameraApply:basisQualified=false,basisUnavailableReason=basis_derivative_not_authority_eligible"
    ),
    true
  );

  // Single-asset manual log: honest resolver byte-access statement for
  // A-crop only, registry-scoped A-parent facts, no dual-re-read claim.
  assert.match(
    execution.manualObservationLog,
    /re-read, re-hashed, and re-decoded A-crop from its canonical committed path/
  );
  assert.match(execution.manualObservationLog, /A-parent bytes were not re-read in this run/);
  assert.match(
    execution.manualObservationLog,
    /persisted A-parent fingerprint used by the supporting comparison is the registry-committed digest/
  );
  assert.match(
    execution.manualObservationLog,
    /declared token was obtained only from result\.reason/
  );
  assert.match(
    execution.manualObservationLog,
    /proves the committed derivative-basis refusal guard only; it does not prove automatic crop detection/
  );
  assert.match(
    execution.manualObservationLog,
    /basis_fingerprint_mismatch because fingerprint comparison precedes the later dimension and basis-kind guards/
  );
  assert.match(
    execution.manualObservationLog,
    /does not make restore_or_import_result a pass axis/
  );
  assert.match(
    execution.manualObservationLog,
    /apply gate refused with the declared token at the basis gate/
  );
  assert.match(
    execution.manualObservationLog,
    /All byte access occurred solely in resolver provenance verification/
  );
  assert.doesNotMatch(execution.manualObservationLog, /both A-crop and A-parent/);
  assert.doesNotMatch(execution.manualObservationLog, /re-read[^.]*A-parent and/);
  assert.doesNotMatch(execution.manualObservationLog, /route|loopback|live-client|model|tripwire/i);

  const runMetadata = await buildNonPStaleRunMetadata({
    minimalInput: buildMinimalInput(),
    provenance,
  });
  const record = buildNonPStaleObservedRunRecord({
    probeId: "P-crop",
    provenance,
    runMetadata,
    execution,
  });
  assert.deepEqual(
    await validateG0ObservedRunRecord({
      fixtureReceipt: provenance.fixtureReceipt,
      record,
    }),
    { ok: true }
  );
  assert.deepEqual(
    record.supportingHarnessChecks.map(
      (check) => `${check.checkId}:${check.required}:${check.status}`
    ),
    [
      "restore_comparison_changed_byte_crop:true:passed",
      "apply_gate_defense_in_depth:true:passed",
    ]
  );
  assert.equal(
    record.supportingHarnessChecks[0].notes,
    P_CROP_RESTORE_COMPARISON_CLARIFICATION
  );
  assert.deepEqual(
    record.noAuthorityChecks.map((check) => `${check.checkId}:${check.status}`),
    [
      "qualification_refusal_result:pass",
      "restore_or_import_result:not_run",
      "route_response_result:not_run",
      "apply_gate_defense_in_depth:pass",
      "client_discard_predicate:not_run",
      "live_snapshot_state_observation:not_run",
      "state_transition_predicate:not_run",
    ]
  );
  assert.equal(record.primaryObservation.observationKind, "emitted_application_result");
  assert.equal(record.primaryObservation.observedPipelineStage, "server basis evidence evaluation");
  assert.equal(record.primaryObservation.observedOperationalState, "calibration_not_attempted");
  assert.equal(
    record.primaryObservation.emittedResult,
    "basis_derivative_not_authority_eligible"
  );
  assert.equal(record.primaryObservation.derivedContainmentConclusion, null);
  assert.deepEqual(record.primaryObservation.rawObservationReferences, []);
  assert.equal(record.incidentReference, null);
  assert.equal(record.runMetadata.runIdentity.basisFingerprint, A_CROP_SHA_LITERAL);

  assert.equal(new Set(record.artifactReferences).size, record.artifactReferences.length);
  assert.equal(
    record.artifactReferences.includes("execution_mode:deterministic_execution_observed"),
    true
  );
  assert.equal(
    record.artifactReferences.some((entry) => entry.includes("/A-parent.jpg")),
    false
  );

  const persistedText = JSON.stringify(record).toLowerCase();
  for (const forbidden of [
    "evaluator",
    "capability",
    "metric",
    "authority_label",
    "external_reference",
  ]) {
    assert.equal(persistedText.includes(forbidden), false);
  }
});

test("P-crop primary token derives from result.reason with pinned guard order", () => {
  const pcropShapedMetadata = { width: 280, height: 220, orientation: 1 };

  const primary = evaluateCalibrationImageBasisEvidence({
    basisKind: "derivative",
    browserDimensions: null,
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    metadata: pcropShapedMetadata,
  });
  assert.equal(primary.ok, false);
  if (primary.ok) {
    throw new Error("unexpected_p_crop_primary_shape");
  }
  assert.equal(primary.reason, "basis_derivative_not_authority_eligible");

  // Coordinate-space guard fires first, even when derivative, orientation,
  // and dimension differences are all present.
  const coordinateSpacePreemption = evaluateCalibrationImageBasisEvidence({
    basisKind: "derivative",
    browserDimensions: { width: 320, height: 240 },
    coordinateSpaceVersion: {
      ...CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
      decoderId: "sharp-metadata/v0",
    },
    metadata: { width: 280, height: 220, orientation: 6 },
  });
  assert.equal(coordinateSpacePreemption.ok, false);
  if (coordinateSpacePreemption.ok) {
    throw new Error("unexpected_coordinate_space_preemption_shape");
  }
  assert.equal(coordinateSpacePreemption.reason, "basis_coordinate_space_mismatch");

  // Derivative fires next, before orientation and dimensions.
  const derivativeBeforeOrientationAndDimensions = evaluateCalibrationImageBasisEvidence({
    basisKind: "derivative",
    browserDimensions: { width: 320, height: 240 },
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    metadata: { width: 280, height: 220, orientation: 6 },
  });
  assert.equal(derivativeBeforeOrientationAndDimensions.ok, false);
  if (derivativeBeforeOrientationAndDimensions.ok) {
    throw new Error("unexpected_derivative_preemption_shape");
  }
  assert.equal(
    derivativeBeforeOrientationAndDimensions.reason,
    "basis_derivative_not_authority_eligible"
  );

  // Orientation fires next, before dimensions.
  const orientationBeforeDimensions = evaluateCalibrationImageBasisEvidence({
    basisKind: "original",
    browserDimensions: { width: 320, height: 240 },
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    metadata: { width: 280, height: 220, orientation: 6 },
  });
  assert.equal(orientationBeforeDimensions.ok, false);
  if (orientationBeforeDimensions.ok) {
    throw new Error("unexpected_orientation_preemption_shape");
  }
  assert.equal(orientationBeforeDimensions.reason, "basis_orientation_not_normal");

  // Dimensions fire last.
  const dimensionsLast = evaluateCalibrationImageBasisEvidence({
    basisKind: "original",
    browserDimensions: { width: 320, height: 240 },
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    metadata: pcropShapedMetadata,
  });
  assert.equal(dimensionsLast.ok, false);
  if (dimensionsLast.ok) {
    throw new Error("unexpected_dimension_mismatch_shape");
  }
  assert.equal(dimensionsLast.reason, "basis_dimension_mismatch");

  // Positive control: original 280x220 basis with browserDimensions=null is
  // authority-eligible, so the P-crop refusal is carried by basisKind alone.
  const positiveControl = evaluateCalibrationImageBasisEvidence({
    basisKind: "original",
    browserDimensions: null,
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    metadata: pcropShapedMetadata,
  });
  assert.deepEqual(positiveControl, { ok: true });
});

test("P-crop pure changed-byte comparison yields fingerprint mismatch before dimension and basis-kind guards", () => {
  const parentDigest = G0_SYNTHETIC_ASSETS["A-parent"].sha256;
  const cropDigest = G0_SYNTHETIC_ASSETS["A-crop"].sha256;
  assert.notEqual(parentDigest, cropDigest);

  const persistedParentCalibration = buildPcropPersistedParentCalibration({
    persistedBasisFingerprint: parentDigest,
    persistedWidth: 320,
    persistedHeight: 240,
  });
  assert.equal(
    persistedParentCalibration.source.imageBasis.sourceImageUrl,
    P_CROP_PINNED_SOURCE_IMAGE_URL
  );
  assert.equal(persistedParentCalibration.source.imageBasis.basisKind, "original");
  assert.equal(persistedParentCalibration.source.imageBasis.encodedOrientation, 1);
  assert.equal(persistedParentCalibration.source.imageBasis.orientationTransform, "identity");

  const currentAcropBasis = buildPcropComparisonImageBasis({
    basisFingerprint: cropDigest,
    decodedWidth: 280,
    decodedHeight: 220,
    basisKind: "derivative",
  });
  // Pinned identically on both sides so only fingerprint, dimensions, and
  // basis kind carry the persisted-vs-current difference.
  assert.equal(currentAcropBasis.sourceImageUrl, P_CROP_PINNED_SOURCE_IMAGE_URL);
  assert.equal(currentAcropBasis.encodedOrientation, 1);
  assert.equal(currentAcropBasis.orientationTransform, "identity");

  const comparison = evaluateCalibrationRestoreCompatibility({
    calibration: persistedParentCalibration,
    currentImageBasis: currentAcropBasis,
  });
  assert.equal(comparison.ok, false);
  if (comparison.ok) {
    throw new Error("unexpected_changed_byte_comparison_shape");
  }
  assert.equal(comparison.reason, "basis_fingerprint_mismatch");
  // The supporting result is not the P-crop primary token.
  assert.notEqual(comparison.reason, "basis_derivative_not_authority_eligible");

  // Equal-fingerprint counterfactual: the 280x220-vs-320x240 dimension
  // difference is real but shadowed; with fingerprints equal it fires next.
  const equalFingerprintCounterfactual = evaluateCalibrationRestoreCompatibility({
    calibration: persistedParentCalibration,
    currentImageBasis: buildPcropComparisonImageBasis({
      basisFingerprint: parentDigest,
      decodedWidth: 280,
      decodedHeight: 220,
      basisKind: "derivative",
    }),
  });
  assert.equal(equalFingerprintCounterfactual.ok, false);
  if (equalFingerprintCounterfactual.ok) {
    throw new Error("unexpected_equal_fingerprint_counterfactual_shape");
  }
  assert.equal(equalFingerprintCounterfactual.reason, "basis_dimension_mismatch");

  // Basis-kind-last counterfactual: with fingerprint and dimensions equal,
  // the derivative basis kind is the last guard to fire.
  const basisKindLastCounterfactual = evaluateCalibrationRestoreCompatibility({
    calibration: persistedParentCalibration,
    currentImageBasis: buildPcropComparisonImageBasis({
      basisFingerprint: parentDigest,
      decodedWidth: 320,
      decodedHeight: 240,
      basisKind: "derivative",
    }),
  });
  assert.equal(basisKindLastCounterfactual.ok, false);
  if (basisKindLastCounterfactual.ok) {
    throw new Error("unexpected_basis_kind_counterfactual_shape");
  }
  assert.equal(basisKindLastCounterfactual.reason, "basis_derivative_not_authority_eligible");

  // Identity control: an identical original basis restores cleanly.
  const identityControl = evaluateCalibrationRestoreCompatibility({
    calibration: persistedParentCalibration,
    currentImageBasis: buildPcropComparisonImageBasis({
      basisFingerprint: parentDigest,
      decodedWidth: 320,
      decodedHeight: 240,
      basisKind: "original",
    }),
  });
  assert.deepEqual(identityControl, { ok: true, aspectDeltaPercent: 0, warning: null });
});

test("P-crop resolver binding and deterministic adapter fail closed on provenance drift", async () => {
  const provenance = await resolveNonPStaleProvenance("P-crop");

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-crop",
      provenance: {
        ...provenance,
        probeId: "P-empty",
      } as any,
    }),
    /unexpected_provenance_probe:P-crop:P-empty/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-crop",
      provenance: {
        ...provenance,
        evaluatedImageDigest: G0_SYNTHETIC_ASSETS["A-empty"].sha256,
      },
    }),
    /provenance_digest_drift:P-crop/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-crop",
      provenance: {
        ...provenance,
        payloadIdentity: "unexpected",
      },
    }),
    /payload_fields_must_be_null:P-crop/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-crop",
      provenance: {
        ...provenance,
        driftImageDigest: G0_SYNTHETIC_ASSETS["A-drift-b"].sha256,
      },
    }),
    /drift_digest_must_be_null:P-crop/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-crop",
      provenance: {
        ...provenance,
        canonicalRepoRelativePaths: [
          "app/admin/3d-room-lab/g0-containment/synthetic-assets/A-empty.jpg",
        ],
      },
    }),
    /canonical_a_crop_path_missing:P-crop/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-crop",
      provenance: {
        ...provenance,
        fixtureReceipt: {
          ...provenance.fixtureReceipt,
          expectedRefusalOrContainmentResult: "basis_dimension_mismatch",
        },
      },
    }),
    /declaration_expected_result_mismatch:P-crop/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-crop",
      provenance: {
        ...provenance,
        fixtureReceipt: {
          ...provenance.fixtureReceipt,
          expectedPipelineStage: "restore image-basis receipt comparison",
        },
      },
    }),
    /declaration_expected_stage_mismatch:P-crop/
  );

  const dimensionsReference = provenance.artifactReferences.find((entry) =>
    entry.startsWith("fixture_image_dimensions:")
  );
  const orientationReference = provenance.artifactReferences.find((entry) =>
    entry.startsWith("fixture_image_orientation:")
  );
  assert.ok(dimensionsReference);
  assert.ok(orientationReference);
  assert.equal(dimensionsReference, "fixture_image_dimensions:280x220");
  assert.equal(orientationReference, "fixture_image_orientation:1");

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-crop",
      provenance: {
        ...provenance,
        artifactReferences: [
          ...replaceFirstExact(
            provenance.artifactReferences,
            dimensionsReference!,
            "fixture_image_dimensions:320x240"
          ),
        ],
      },
    }),
    /resolver_bound_metadata_mismatch:P-crop/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-crop",
      provenance: {
        ...provenance,
        artifactReferences: [
          ...replaceFirstExact(
            provenance.artifactReferences,
            orientationReference!,
            "fixture_image_orientation:6"
          ),
        ],
      },
    }),
    /resolver_bound_metadata_mismatch:P-crop/
  );

  await assert.rejects(
    runDeterministicFirstSliceExecution({
      probeId: "P-crop",
      provenance: {
        ...provenance,
        artifactReferences: [
          ...removeReferencesWithPrefix(provenance.artifactReferences, "fixture_image_dimensions:"),
        ],
      },
    }),
    /missing_fixture_image_dimensions_reference:P-crop/
  );

  // Adapter-level registry-lineage guard.
  await withMutatedSyntheticAsset(
    "A-crop",
    (asset) => {
      asset.parentAssetId = null;
    },
    async () => {
      await assert.rejects(
        runDeterministicFirstSliceExecution({ probeId: "P-crop", provenance }),
        /parent_lineage_drift:P-crop/
      );
    }
  );

  // Adapter-level pinned parent registry-fact guard.
  await withMutatedSyntheticAsset(
    "A-parent",
    (asset) => {
      asset.decodedWidth = 999;
    },
    async () => {
      await assert.rejects(
        runDeterministicFirstSliceExecution({ probeId: "P-crop", provenance }),
        /parent_registry_facts_drift:P-crop/
      );
    }
  );

  // Explicit parent-digest-inequality guard: fail closed when A-crop and
  // A-parent digests are artificially made equal.
  await withMutatedSyntheticAsset(
    "A-parent",
    (asset) => {
      asset.sha256 = G0_SYNTHETIC_ASSETS["A-crop"].sha256;
    },
    async () => {
      await assert.rejects(
        runDeterministicFirstSliceExecution({ probeId: "P-crop", provenance }),
        /parent_and_crop_digests_equal:P-crop/
      );
    }
  );
});

test("P-crop builder and validator reject missing, duplicate, and non-passed required supporting checks", async () => {
  const provenance = await resolveNonPStaleProvenance("P-crop");
  const execution = await runDeterministicFirstSliceExecution({
    probeId: "P-crop",
    provenance,
  });
  const runMetadata = await buildNonPStaleRunMetadata({
    minimalInput: buildMinimalInput(),
    provenance,
  });

  assert.throws(
    () =>
      buildNonPStaleObservedRunRecord({
        probeId: "P-crop",
        provenance,
        runMetadata,
        execution: {
          ...execution,
          supportingChecks: [execution.supportingChecks[1]],
        },
      }),
    /missing_required_supporting_check:restore_comparison_changed_byte_crop/
  );

  assert.throws(
    () =>
      buildNonPStaleObservedRunRecord({
        probeId: "P-crop",
        provenance,
        runMetadata,
        execution: {
          ...execution,
          supportingChecks: [
            execution.supportingChecks[0],
            execution.supportingChecks[0],
            execution.supportingChecks[1],
          ],
        },
      }),
    /duplicate_supporting_check:restore_comparison_changed_byte_crop/
  );

  assert.throws(
    () =>
      buildNonPStaleObservedRunRecord({
        probeId: "P-crop",
        provenance,
        runMetadata,
        execution: {
          ...execution,
          supportingChecks: [
            { ...execution.supportingChecks[0], status: "not_run" as const },
            execution.supportingChecks[1],
          ],
        },
      }),
    /required_supporting_check_not_passed:restore_comparison_changed_byte_crop/
  );

  assert.throws(
    () =>
      buildNonPStaleObservedRunRecord({
        probeId: "P-crop",
        provenance,
        runMetadata,
        execution: {
          ...execution,
          supportingChecks: [
            ...execution.supportingChecks,
            { checkId: "unknown_check", status: "passed" as const, failureClass: null },
          ],
        },
      }),
    /unknown_supporting_check/
  );

  const record = buildNonPStaleObservedRunRecord({
    probeId: "P-crop",
    provenance,
    runMetadata,
    execution,
  });

  assert.deepEqual(
    await validateG0ObservedRunRecord({
      fixtureReceipt: provenance.fixtureReceipt,
      record: {
        ...record,
        supportingHarnessChecks: record.supportingHarnessChecks.filter(
          (check) => check.checkId !== "restore_comparison_changed_byte_crop"
        ),
      },
    }),
    { ok: false, reason: "missing_required_supporting_check:restore_comparison_changed_byte_crop" }
  );

  assert.deepEqual(
    await validateG0ObservedRunRecord({
      fixtureReceipt: provenance.fixtureReceipt,
      record: {
        ...record,
        supportingHarnessChecks: [
          ...record.supportingHarnessChecks,
          record.supportingHarnessChecks[0],
        ],
      },
    }),
    { ok: false, reason: "duplicate_supporting_check:restore_comparison_changed_byte_crop" }
  );

  assert.deepEqual(
    await validateG0ObservedRunRecord({
      fixtureReceipt: provenance.fixtureReceipt,
      record: {
        ...record,
        supportingHarnessChecks: record.supportingHarnessChecks.map((check) =>
          check.checkId === "restore_comparison_changed_byte_crop"
            ? { ...check, status: "not_run" as const }
            : check
        ),
      },
    }),
    { ok: false, reason: "required_supporting_check_not_passed:restore_comparison_changed_byte_crop" }
  );
});

test("minimal input parser rejects malformed and forbidden override fields", () => {
  assert.throws(() => parseNonPStaleMinimalInput("nope"), /input_must_be_object/);
  assert.throws(
    () =>
      parseNonPStaleMinimalInput({
        executionNonce: "x",
        rerunReason: "evaluation_changed",
      }),
    /invalid_createdAt/
  );
  assert.throws(
    () =>
      parseNonPStaleMinimalInput({
        ...buildMinimalInput(),
        emittedResult: "basis_legacy_receipt_missing",
      }),
    /forbidden_or_unknown_input_fields/
  );
});

test("wrong bytes are rejected even if expected derivative token is known", async () => {
  await withMutatedSyntheticAsset(
    "A-empty",
    (asset) => {
      asset.sha256 = "1".repeat(64);
    },
    async () => {
      await assert.rejects(resolveNonPStaleProvenance("P-empty"), /image_digest_drift/);
    }
  );
});

test("basis-evidence controls cover P-dimension and P-gen preemption order deterministically", () => {
  const positiveOriginal = evaluateCalibrationImageBasisEvidence({
    basisKind: "original",
    browserDimensions: { width: 320, height: 240 },
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    metadata: { width: 320, height: 240, orientation: 1 },
  });
  assert.deepEqual(positiveOriginal, { ok: true });

  const dimensionMismatch = evaluateCalibrationImageBasisEvidence({
    basisKind: "original",
    browserDimensions: P_DIMENSION_PINNED_SYNTHETIC_DIMENSIONS,
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    metadata: { width: 320, height: 240, orientation: 1 },
  });
  assert.equal(dimensionMismatch.ok, false);
  if (dimensionMismatch.ok) {
    throw new Error("unexpected_dimension_mismatch_shape");
  }
  assert.equal(dimensionMismatch.reason, "basis_dimension_mismatch");

  const coordinateSpacePreemption = evaluateCalibrationImageBasisEvidence({
    basisKind: "original",
    browserDimensions: P_DIMENSION_PINNED_SYNTHETIC_DIMENSIONS,
    coordinateSpaceVersion: {
      ...CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
      decoderId: "sharp-metadata/v0",
    },
    metadata: { width: 320, height: 240, orientation: 1 },
  });
  assert.equal(coordinateSpacePreemption.ok, false);
  if (coordinateSpacePreemption.ok) {
    throw new Error("unexpected_coordinate_space_preemption_shape");
  }
  assert.equal(coordinateSpacePreemption.reason, "basis_coordinate_space_mismatch");

  const derivativePreemption = evaluateCalibrationImageBasisEvidence({
    basisKind: "derivative",
    browserDimensions: P_DIMENSION_PINNED_SYNTHETIC_DIMENSIONS,
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    metadata: { width: 320, height: 240, orientation: 1 },
  });
  assert.equal(derivativePreemption.ok, false);
  if (derivativePreemption.ok) {
    throw new Error("unexpected_derivative_preemption_shape");
  }
  assert.equal(derivativePreemption.reason, "basis_derivative_not_authority_eligible");

  const orientationPreemption = evaluateCalibrationImageBasisEvidence({
    basisKind: "original",
    browserDimensions: P_DIMENSION_PINNED_SYNTHETIC_DIMENSIONS,
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    metadata: { width: 320, height: 240, orientation: 2 },
  });
  assert.equal(orientationPreemption.ok, false);
  if (orientationPreemption.ok) {
    throw new Error("unexpected_orientation_preemption_shape");
  }
  assert.equal(orientationPreemption.reason, "basis_orientation_not_normal");
});

test("CLI allows P-gen, P-crop, P-dimension-mismatch, P-url-drift, and X4 but rejects P-stale and P-empty", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "g0-non-p-stale-cli-reject-"));
  try {
    const inputPath = await writeInputFile(root, buildMinimalInput());
    const pgenDryRun = runCli(["--probe", "P-gen", "--input", inputPath, "--root-dir", root]);
    assert.equal(pgenDryRun.status, 0);
    assert.match(pgenDryRun.stdout, /execution_mode=deterministic_execution_observed/);
    assert.match(pgenDryRun.stdout, /mode=dry-run/);

    const pdimensionDryRun = runCli([
      "--probe",
      "P-dimension-mismatch",
      "--input",
      inputPath,
      "--root-dir",
      root,
    ]);
    assert.equal(pdimensionDryRun.status, 0);
    assert.match(pdimensionDryRun.stdout, /execution_mode=deterministic_execution_observed/);
    assert.match(pdimensionDryRun.stdout, /mode=dry-run/);

    const x4DryRun = runCli(["--probe", "X4", "--input", inputPath, "--root-dir", root]);
    assert.equal(x4DryRun.status, 0);
    assert.match(x4DryRun.stdout, /execution_mode=deterministic_execution_observed/);
    assert.match(x4DryRun.stdout, /mode=dry-run/);

    const pUrlDriftDryRun = runCli([
      "--probe",
      "P-url-drift",
      "--input",
      inputPath,
      "--root-dir",
      root,
    ]);
    assert.equal(pUrlDriftDryRun.status, 0);
    assert.match(pUrlDriftDryRun.stdout, /execution_mode=deterministic_execution_observed/);
    assert.match(pUrlDriftDryRun.stdout, /schema_and_contract_validation=passed/);
    assert.match(pUrlDriftDryRun.stdout, /mode=dry-run/);

    const pcropDryRun = runCli(["--probe", "P-crop", "--input", inputPath, "--root-dir", root]);
    assert.equal(pcropDryRun.status, 0);
    assert.match(pcropDryRun.stdout, /execution_mode=deterministic_execution_observed/);
    assert.match(pcropDryRun.stdout, /schema_and_contract_validation=passed/);
    assert.match(pcropDryRun.stdout, /mode=dry-run/);
    assert.equal(await countJsonFiles(path.join(root, "g0-containment", "receipts")), 0);

    const stale = runCli(["--probe", "P-stale", "--input", inputPath, "--root-dir", root]);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /no_execution_adapter_yet:P-stale/);

    for (const probeId of ["P-empty"] as const) {
      const unsupported = runCli(["--probe", probeId, "--input", inputPath, "--root-dir", root]);
      assert.equal(unsupported.status, 1);
      assert.match(unsupported.stderr, new RegExp(`no_execution_adapter_yet:${probeId}`));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI write uses temp root, writes one immutable P-dimension record, and repeat write fails target exists", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "g0-non-p-stale-cli-write-"));
  try {
    const inputPath = await writeInputFile(root, buildMinimalInput());
    const first = runCli([
      "--probe",
      "P-dimension-mismatch",
      "--input",
      inputPath,
      "--root-dir",
      root,
      "--write",
    ]);
    assert.equal(first.status, 0);
    assert.match(first.stdout, /mode=write/);
    assert.match(first.stdout, /post_write_re_read_validation=passed/);
    const recordPath = first.stdout
      .split("\n")
      .find((line) => line.startsWith("record_path="))
      ?.replace("record_path=", "")
      .trim();
    assert.ok(recordPath);
    assert.ok(recordPath!.startsWith(root));
    assert.equal(await countJsonFiles(path.join(root, "g0-containment", "receipts")), 1);

    const persisted = JSON.parse(await readFile(recordPath!, "utf8")) as G0ObservedRunRecord;
    const provenance = await resolveNonPStaleProvenance("P-dimension-mismatch");
    assert.deepEqual(
      await validateG0ObservedRunRecord({
        fixtureReceipt: provenance.fixtureReceipt,
        record: persisted,
      }),
      { ok: true }
    );

    const second = runCli([
      "--probe",
      "P-dimension-mismatch",
      "--input",
      inputPath,
      "--root-dir",
      root,
      "--write",
    ]);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /target_path_exists/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI X4 write uses temp root, re-validates the persisted record, and repeat write fails target exists", async () => {
  const beforeCount = await countJsonFiles(REPO_RECEIPTS_ROOT);
  const beforeHashes = await collectJsonFileHashes(REPO_RECEIPTS_ROOT);
  const root = await mkdtemp(path.join(tmpdir(), "g0-non-p-stale-cli-x4-write-"));
  try {
    const inputPath = await writeInputFile(root, buildMinimalInput());
    const first = runCli(["--probe", "X4", "--input", inputPath, "--root-dir", root, "--write"]);
    assert.equal(first.status, 0);
    assert.match(first.stdout, /execution_mode=deterministic_execution_observed/);
    assert.match(first.stdout, /mode=write/);
    assert.match(first.stdout, /post_write_re_read_validation=passed/);
    const recordPath = first.stdout
      .split("\n")
      .find((line) => line.startsWith("record_path="))
      ?.replace("record_path=", "")
      .trim();
    assert.ok(recordPath);
    assert.ok(recordPath!.startsWith(root));
    assert.equal(await countJsonFiles(path.join(root, "g0-containment", "receipts")), 1);

    const persisted = JSON.parse(await readFile(recordPath!, "utf8")) as G0ObservedRunRecord;
    const provenance = await resolveNonPStaleProvenance("X4");
    assert.deepEqual(
      await validateG0ObservedRunRecord({
        fixtureReceipt: provenance.fixtureReceipt,
        record: persisted,
      }),
      { ok: true }
    );
    assert.equal(persisted.probeId, "X4");
    assert.equal(persisted.primaryObservation.emittedResult, "basis_orientation_not_normal");
    assert.equal(
      persisted.noAuthorityChecks.find((check) => check.checkId === "route_response_result")
        ?.status,
      "not_run"
    );
    assert.equal(
      persisted.supportingHarnessChecks.find(
        (check) => check.checkId === "vision_route_pre_model_orientation_refusal"
      )?.notes,
      X4_ROUTE_RESPONSE_CLARIFICATION
    );
    assert.equal(
      new Set(persisted.artifactReferences).size,
      persisted.artifactReferences.length
    );

    const second = runCli(["--probe", "X4", "--input", inputPath, "--root-dir", root, "--write"]);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /target_path_exists/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(await countJsonFiles(REPO_RECEIPTS_ROOT), beforeCount);
  assert.deepEqual(await collectJsonFileHashes(REPO_RECEIPTS_ROOT), beforeHashes);
});

test("CLI P-crop write uses temp root, re-validates the persisted record, and preserves the repository durable-receipt baseline byte-for-byte", async () => {
  // Derive the durable-receipt baseline dynamically from the live repository
  // tree so this precondition never goes stale as receipts are added.
  const beforeCount = await countJsonFiles(REPO_RECEIPTS_ROOT);
  const beforeHashes = await collectJsonFileHashes(REPO_RECEIPTS_ROOT);
  assert.ok(
    beforeCount > 0,
    "expected at least one durable receipt in the repository baseline",
  );
  assert.equal(beforeHashes.length, beforeCount);
  const root = await mkdtemp(path.join(tmpdir(), "g0-non-p-stale-cli-p-crop-write-"));
  try {
    const inputPath = await writeInputFile(root, buildMinimalInput());

    // Dry run writes neither a repository receipt nor a temp-root receipt.
    const dryRun = runCli(["--probe", "P-crop", "--input", inputPath, "--root-dir", root]);
    assert.equal(dryRun.status, 0);
    assert.match(dryRun.stdout, /execution_mode=deterministic_execution_observed/);
    assert.match(dryRun.stdout, /schema_and_contract_validation=passed/);
    assert.match(dryRun.stdout, /mode=dry-run/);
    assert.equal(await countJsonFiles(path.join(root, "g0-containment", "receipts")), 0);

    const first = runCli(["--probe", "P-crop", "--input", inputPath, "--root-dir", root, "--write"]);
    assert.equal(first.status, 0);
    assert.match(first.stdout, /execution_mode=deterministic_execution_observed/);
    assert.match(first.stdout, /mode=write/);
    assert.match(first.stdout, /post_write_re_read_validation=passed/);
    const recordPath = first.stdout
      .split("\n")
      .find((line) => line.startsWith("record_path="))
      ?.replace("record_path=", "")
      .trim();
    assert.ok(recordPath);
    assert.ok(recordPath!.startsWith(root));
    assert.equal(await countJsonFiles(path.join(root, "g0-containment", "receipts")), 1);

    const persisted = JSON.parse(await readFile(recordPath!, "utf8")) as G0ObservedRunRecord;
    const provenance = await resolveNonPStaleProvenance("P-crop");
    assert.deepEqual(
      await validateG0ObservedRunRecord({
        fixtureReceipt: provenance.fixtureReceipt,
        record: persisted,
      }),
      { ok: true }
    );
    assert.equal(persisted.probeId, "P-crop");
    assert.equal(
      persisted.primaryObservation.emittedResult,
      "basis_derivative_not_authority_eligible"
    );
    assert.equal(
      persisted.primaryObservation.observedPipelineStage,
      "server basis evidence evaluation"
    );
    assert.equal(
      persisted.noAuthorityChecks.find((check) => check.checkId === "restore_or_import_result")
        ?.status,
      "not_run"
    );
    assert.equal(
      persisted.noAuthorityChecks.find((check) => check.checkId === "route_response_result")
        ?.status,
      "not_run"
    );
    assert.deepEqual(
      persisted.supportingHarnessChecks.map(
        (check) => `${check.checkId}:${check.required}:${check.status}`
      ),
      [
        "restore_comparison_changed_byte_crop:true:passed",
        "apply_gate_defense_in_depth:true:passed",
      ]
    );
    assert.equal(
      persisted.supportingHarnessChecks.find(
        (check) => check.checkId === "restore_comparison_changed_byte_crop"
      )?.notes,
      P_CROP_RESTORE_COMPARISON_CLARIFICATION
    );
    assert.equal(
      persisted.artifactReferences.includes(
        `restore_comparison_persisted_registry_fingerprint:${A_PARENT_SHA_LITERAL}`
      ),
      true
    );
    assert.equal(
      persisted.artifactReferences.includes(
        `restore_comparison_current_fingerprint:${A_CROP_SHA_LITERAL}`
      ),
      true
    );
    assert.equal(
      persisted.artifactReferences.includes(
        "restore_comparison_observed_result:basis_fingerprint_mismatch"
      ),
      true
    );
    assert.equal(
      persisted.artifactReferences.some((entry) => entry.includes("/A-parent.jpg")),
      false
    );
    assert.equal(
      new Set(persisted.artifactReferences).size,
      persisted.artifactReferences.length
    );
    const persistedText = JSON.stringify(persisted).toLowerCase();
    for (const forbidden of [
      "evaluator",
      "capability",
      "metric",
      "authority_label",
      "external_reference",
    ]) {
      assert.equal(persistedText.includes(forbidden), false);
    }

    const second = runCli(["--probe", "P-crop", "--input", inputPath, "--root-dir", root, "--write"]);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /target_path_exists/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(await countJsonFiles(REPO_RECEIPTS_ROOT), beforeCount);
  assert.deepEqual(await collectJsonFileHashes(REPO_RECEIPTS_ROOT), beforeHashes);
});

test("CLI P-url-drift write uses temp root, re-validates the persisted record, and preserves the repository durable-receipt baseline byte-for-byte", async () => {
  // Derive the durable-receipt baseline dynamically from the live repository
  // tree so this precondition never goes stale as receipts are added.
  const beforeCount = await countJsonFiles(REPO_RECEIPTS_ROOT);
  const beforeHashes = await collectJsonFileHashes(REPO_RECEIPTS_ROOT);
  assert.ok(beforeCount > 0, "expected at least one durable receipt in the repository baseline");
  assert.equal(beforeHashes.length, beforeCount);
  const beforeHashByPath = new Map<string, string>();
  for (const entry of beforeHashes) {
    const separatorIndex = entry.lastIndexOf(":");
    assert.ok(separatorIndex > 0, `malformed baseline hash entry: ${entry}`);
    const relativePath = entry.slice(0, separatorIndex);
    const digest = entry.slice(separatorIndex + 1);
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.equal(beforeHashByPath.has(relativePath), false, `duplicate baseline path: ${relativePath}`);
    beforeHashByPath.set(relativePath, digest);
  }
  assert.equal(beforeHashByPath.size, beforeCount);
  const root = await mkdtemp(path.join(tmpdir(), "g0-non-p-stale-cli-p-url-drift-write-"));
  try {
    const inputPath = await writeInputFile(root, buildMinimalInput());
    const first = runCli([
      "--probe",
      "P-url-drift",
      "--input",
      inputPath,
      "--root-dir",
      root,
      "--write",
    ]);
    assert.equal(first.status, 0);
    assert.match(first.stdout, /execution_mode=deterministic_execution_observed/);
    assert.match(first.stdout, /mode=write/);
    assert.match(first.stdout, /post_write_re_read_validation=passed/);
    const recordPath = first.stdout
      .split("\n")
      .find((line) => line.startsWith("record_path="))
      ?.replace("record_path=", "")
      .trim();
    assert.ok(recordPath);
    assert.ok(recordPath!.startsWith(root));
    assert.equal(await countJsonFiles(path.join(root, "g0-containment", "receipts")), 1);

    const persisted = JSON.parse(await readFile(recordPath!, "utf8")) as G0ObservedRunRecord;
    const provenance = await resolveNonPStaleProvenance("P-url-drift");
    assert.deepEqual(
      await validateG0ObservedRunRecord({
        fixtureReceipt: provenance.fixtureReceipt,
        record: persisted,
      }),
      { ok: true }
    );
    assert.equal(persisted.probeId, "P-url-drift");
    assert.equal(persisted.primaryObservation.emittedResult, "basis_fingerprint_mismatch");
    assert.equal(
      persisted.primaryObservation.observedPipelineStage,
      "restore image-basis receipt comparison"
    );
    assert.equal(
      persisted.noAuthorityChecks.find((check) => check.checkId === "route_response_result")
        ?.status,
      "pass"
    );
    assert.deepEqual(
      persisted.supportingHarnessChecks.map(
        (check) => `${check.checkId}:${check.required}:${check.status}`
      ),
      [
        "vision_route_mismatch_discard:true:passed",
        "empty_room_route_mismatch_discard:true:passed",
        "client_discard_predicate:true:passed",
        "apply_gate_defense_in_depth:true:passed",
      ]
    );
    assert.equal(
      persisted.artifactReferences.includes(
        `vision_route_attested_basis_fingerprint:${A_DRIFT_B_SHA_LITERAL}`
      ),
      true
    );
    assert.equal(
      persisted.artifactReferences.includes(
        `empty_room_route_attested_basis_fingerprint:${A_DRIFT_B_SHA_LITERAL}`
      ),
      true
    );
    assert.equal(
      persisted.artifactReferences.includes(
        `expected_basis_fingerprint_sent:${A_PARENT_SHA_LITERAL}`
      ),
      true
    );
    assert.equal(
      new Set(persisted.artifactReferences).size,
      persisted.artifactReferences.length
    );
    const persistedText = JSON.stringify(persisted).toLowerCase();
    for (const forbidden of [
      "evaluator",
      "capability",
      "metric",
      "authority_label",
      "external_reference",
    ]) {
      assert.equal(persistedText.includes(forbidden), false);
    }

    const second = runCli([
      "--probe",
      "P-url-drift",
      "--input",
      inputPath,
      "--root-dir",
      root,
      "--write",
    ]);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /target_path_exists/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  const afterCount = await countJsonFiles(REPO_RECEIPTS_ROOT);
  const afterHashes = await collectJsonFileHashes(REPO_RECEIPTS_ROOT);
  assert.equal(afterCount, beforeCount);
  assert.deepEqual(afterHashes, beforeHashes);
  for (const entry of afterHashes) {
    const separatorIndex = entry.lastIndexOf(":");
    const relativePath = entry.slice(0, separatorIndex);
    const digest = entry.slice(separatorIndex + 1);
    assert.equal(beforeHashByPath.get(relativePath), digest);
  }
});

test("tests do not create or mutate repository receipt records", async () => {
  const beforeCount = await countJsonFiles(REPO_RECEIPTS_ROOT);
  const beforeHashes = await collectJsonFileHashes(REPO_RECEIPTS_ROOT);
  const root = await mkdtemp(path.join(tmpdir(), "g0-non-p-stale-cli-repo-guard-"));
  try {
    const inputPath = await writeInputFile(root, buildMinimalInput());
    const run = runCli([
      "--probe",
      "P-dimension-mismatch",
      "--input",
      inputPath,
      "--root-dir",
      root,
      "--write",
    ]);
    assert.equal(run.status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  const afterCount = await countJsonFiles(REPO_RECEIPTS_ROOT);
  const afterHashes = await collectJsonFileHashes(REPO_RECEIPTS_ROOT);
  assert.equal(afterCount, beforeCount);
  assert.deepEqual(afterHashes, beforeHashes);
});
