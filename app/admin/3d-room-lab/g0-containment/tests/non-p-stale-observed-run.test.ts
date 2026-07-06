import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { validateG0ObservedRunRecord, type G0ObservedRunRecord } from "../observed-run-record";
import {
  buildNonPStaleObservedRunRecord,
  buildNonPStaleRunMetadata,
  parseNonPStaleMinimalInput,
  type NonPStaleExecutionEvidence,
  type NonPStaleMinimalInput,
} from "../non-p-stale-observed-run-builder";
import { runDeterministicFirstSliceExecution } from "../non-p-stale-first-slice-execution";
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

test("CLI rejects P-stale and unsupported probes, and dry-run writes nothing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "g0-non-p-stale-cli-reject-"));
  try {
    const inputPath = await writeInputFile(root, buildMinimalInput());
    const stale = runCli(["--probe", "P-stale", "--input", inputPath, "--root-dir", root]);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /no_execution_adapter_yet:P-stale/);

    const unsupported = runCli(["--probe", "P-crop", "--input", inputPath, "--root-dir", root]);
    assert.equal(unsupported.status, 1);
    assert.match(unsupported.stderr, /no_execution_adapter_yet:P-crop/);

    const dryRun = runCli(["--probe", "P-legacy", "--input", inputPath, "--root-dir", root]);
    assert.equal(dryRun.status, 0);
    assert.match(dryRun.stdout, /execution_mode=deterministic_execution_observed/);
    assert.match(dryRun.stdout, /mode=dry-run/);
    assert.equal(await countJsonFiles(path.join(root, "g0-containment", "receipts")), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI write uses temp root, re-read validates, and repeat write fails target exists", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "g0-non-p-stale-cli-write-"));
  try {
    const inputPath = await writeInputFile(root, buildMinimalInput());
    const first = runCli([
      "--probe",
      "P-coordinate-space-drift",
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

    const persisted = JSON.parse(await readFile(recordPath!, "utf8")) as G0ObservedRunRecord;
    const provenance = await resolveNonPStaleProvenance("P-coordinate-space-drift");
    assert.deepEqual(
      await validateG0ObservedRunRecord({
        fixtureReceipt: provenance.fixtureReceipt,
        record: persisted,
      }),
      { ok: true }
    );

    const second = runCli([
      "--probe",
      "P-coordinate-space-drift",
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

test("tests do not create new repository receipt records", async () => {
  const before = await countJsonFiles(REPO_RECEIPTS_ROOT);
  const root = await mkdtemp(path.join(tmpdir(), "g0-non-p-stale-cli-repo-guard-"));
  try {
    const inputPath = await writeInputFile(root, buildMinimalInput());
    const run = runCli(["--probe", "P-legacy", "--input", inputPath, "--root-dir", root, "--write"]);
    assert.equal(run.status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  const after = await countJsonFiles(REPO_RECEIPTS_ROOT);
  assert.equal(after, before);
});
