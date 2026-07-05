import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { validateBenchmarkRunReceiptMetadata } from "@/app/admin/3d-room-lab/benchmark-fixture-intake-contract";
import { CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION } from "@/app/admin/3d-room-lab/calibration-image-basis";
import { validateG0ObservedRunRecord, type G0ObservedRunRecord } from "../observed-run-record";
import {
  buildPStaleObservedRunRecord,
  buildPStaleRunMetadata,
  parsePStaleObservedRunWriterInput,
  resolvePStaleActivePreconditionBinding,
  type PStaleObservedRunWriterInput,
} from "../p-stale-observed-run-writer";
import { buildG0ProbeDeclarations } from "../probe-declarations";

const CLI_PATH = path.join(
  process.cwd(),
  "app/admin/3d-room-lab/g0-containment/write-p-stale-observed-run.ts"
);
const DOC_PATH = path.join(
  process.cwd(),
  "app/admin/3d-room-lab/g0-containment/docs/p-stale-observed-run-writer.md"
);
const FIXTURE = buildG0ProbeDeclarations()["P-stale"];
const ACTIVE_BINDING = resolvePStaleActivePreconditionBinding(FIXTURE);

type CliRunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function buildValidInput(overrides?: Partial<PStaleObservedRunWriterInput>): PStaleObservedRunWriterInput {
  return {
    createdAt: "2026-07-05T21:00:00.000Z",
    runIdentity: {
      fixtureVersion: FIXTURE.fixtureVersion,
      basisFingerprint: ACTIVE_BINDING.expectedSha256,
      coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
      solverGeneratorVersion: "g0-harness/v1",
      evaluationVersion: "g0-eval/v1",
      evidenceBundleVersion: "g0-bundle/v1",
    },
    executionNonce: "p-stale-live-observation-1",
    supersedesRunId: null,
    rerunReason: "evaluation_changed",
    baselineFrame: {
      width: 1118,
      height: 698,
      rawObservationReference: "artifact://p-stale/baseline-frame",
    },
    postTriggerFrame: {
      width: 960,
      height: 600,
      rawObservationReference: "artifact://p-stale/post-trigger-frame",
    },
    preconditionArtifact: {
      url: ACTIVE_BINDING.expectedPublicUrl,
      sha256: ACTIVE_BINDING.expectedSha256,
    },
    manualObservationLog:
      "Observed active authority receipt drop after controlled frame-size transition.",
    observedClassification: {
      outcome: "pass",
      expectedVsObservedComparison: "matches_expected",
    },
    ...overrides,
  };
}

async function writeInputFile(dir: string, data: unknown, fileName = "input.json"): Promise<string> {
  const filePath = path.join(dir, fileName);
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  return filePath;
}

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

async function assertNoReceiptsWritten(root: string): Promise<void> {
  const receiptsRoot = path.join(root, "g0-containment", "receipts");
  await assert.rejects(access(receiptsRoot));
}

test("declaration source asset resolves to active v2 registry entry", () => {
  assert.equal(FIXTURE.sourceAssetIdentity.kind, "source_asset");
  assert.equal(FIXTURE.sourceAssetIdentity.sourceAssetId, "P-stale-precondition-v2");
  assert.equal(ACTIVE_BINDING.sourceAssetId, "P-stale-precondition-v2");
  assert.equal(ACTIVE_BINDING.expectedPublicUrl, "http://localhost:3000/3d-lab/room-images/P-stale-precondition-v2.jpg");
  assert.equal(
    ACTIVE_BINDING.expectedSha256,
    "2e8b55c2fb8f8b68ba28f6b01ecf327be32270a51cfde4fa2cfcfbbc29eabd67"
  );
});

test("resolver URL and digest match operator documentation", async () => {
  const doc = await readFile(DOC_PATH, "utf8");
  assert.match(doc, new RegExp(ACTIVE_BINDING.expectedPublicUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(doc, new RegExp(ACTIVE_BINDING.expectedSha256));
});

test("valid v2 pass input succeeds in dry-run and temp-root write mode", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "p-stale-cli-valid-"));
  try {
    const inputPath = await writeInputFile(root, buildValidInput());
    const dry = runCli(["--input", inputPath, "--root-dir", root]);
    assert.equal(dry.status, 0);
    assert.match(dry.stdout, /mode=dry-run/);
    await assertNoReceiptsWritten(root);

    const write = runCli(["--input", inputPath, "--root-dir", root, "--write"]);
    assert.equal(write.status, 0);
    assert.match(write.stdout, /mode=write/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("identical baseline and post-trigger dimensions reject pass", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "p-stale-cli-identical-pass-"));
  try {
    const inputPath = await writeInputFile(root, {
      ...buildValidInput(),
      postTriggerFrame: {
        width: 1118,
        height: 698,
        rawObservationReference: "artifact://p-stale/post-trigger-frame",
      },
    });
    const result = runCli(["--input", inputPath, "--root-dir", root]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /pass_requires_frame_dimension_change/);
    await assertNoReceiptsWritten(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("different width with same height is allowed for pass", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "p-stale-cli-width-diff-"));
  try {
    const inputPath = await writeInputFile(root, {
      ...buildValidInput(),
      baselineFrame: {
        width: 1000,
        height: 700,
        rawObservationReference: "artifact://p-stale/baseline-frame",
      },
      postTriggerFrame: {
        width: 990,
        height: 700,
        rawObservationReference: "artifact://p-stale/post-trigger-frame",
      },
    });
    const result = runCli(["--input", inputPath, "--root-dir", root]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /mode=dry-run/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("different height with same width is allowed for pass", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "p-stale-cli-height-diff-"));
  try {
    const inputPath = await writeInputFile(root, {
      ...buildValidInput(),
      baselineFrame: {
        width: 1000,
        height: 700,
        rawObservationReference: "artifact://p-stale/baseline-frame",
      },
      postTriggerFrame: {
        width: 1000,
        height: 680,
        rawObservationReference: "artifact://p-stale/post-trigger-frame",
      },
    });
    const result = runCli(["--input", inputPath, "--root-dir", root]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /mode=dry-run/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("identical frame allows inconclusive only", async () => {
  const parsed = await parsePStaleObservedRunWriterInput(
    {
      ...buildValidInput({
        observedClassification: {
          outcome: "inconclusive",
          expectedVsObservedComparison: "mismatch",
        },
      }),
      baselineFrame: {
        width: 960,
        height: 600,
        rawObservationReference: "artifact://p-stale/baseline",
      },
      postTriggerFrame: {
        width: 960,
        height: 600,
        rawObservationReference: "artifact://p-stale/post",
      },
      supportingChecks: {
        shouldDropAuthorityOnFrameChange_predicate: {
          status: "not_run",
          failureClass: null,
          notes: "No frame transition observed.",
        },
        precondition_artifact_readouts: {
          status: "passed",
          failureClass: null,
        },
      },
    },
    ACTIVE_BINDING
  );
  assert.equal(parsed.observedClassification.outcome, "inconclusive");

  await assert.rejects(
    parsePStaleObservedRunWriterInput(
      {
        ...buildValidInput({
          observedClassification: {
            outcome: "safety_mismatch",
            expectedVsObservedComparison: "mismatch",
          },
          supportingChecks: {
            shouldDropAuthorityOnFrameChange_predicate: {
              status: "failed",
              failureClass: "safety_mismatch",
            },
            precondition_artifact_readouts: {
              status: "passed",
              failureClass: null,
            },
          },
        }),
        baselineFrame: { width: 960, height: 600, rawObservationReference: "artifact://b" },
        postTriggerFrame: { width: 960, height: 600, rawObservationReference: "artifact://p" },
      },
      ACTIVE_BINDING
    ),
    /identical_frame_requires_inconclusive_outcome/
  );
});

test("wrong URL rejects", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "p-stale-cli-url-"));
  try {
    const inputPath = await writeInputFile(root, {
      ...buildValidInput(),
      preconditionArtifact: {
        url: "http://localhost:3000/3d-lab/room-images/P-stale-precondition.jpg",
        sha256: ACTIVE_BINDING.expectedSha256,
      },
    });
    const result = runCli(["--input", inputPath, "--root-dir", root]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /preconditionArtifact_url_must_match_active_v2/);
    await assertNoReceiptsWritten(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("wrong SHA rejects", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "p-stale-cli-sha-"));
  try {
    const inputPath = await writeInputFile(root, {
      ...buildValidInput(),
      preconditionArtifact: {
        url: ACTIVE_BINDING.expectedPublicUrl,
        sha256: "1".repeat(64),
      },
    });
    const result = runCli(["--input", inputPath, "--root-dir", root]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /preconditionArtifact_sha256_must_match_active_v2/);
    await assertNoReceiptsWritten(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("arbitrary valid-format SHA rejects", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "p-stale-cli-sha-arbitrary-"));
  try {
    const inputPath = await writeInputFile(root, {
      ...buildValidInput(),
      preconditionArtifact: {
        url: ACTIVE_BINDING.expectedPublicUrl,
        sha256: "f".repeat(64),
      },
    });
    const result = runCli(["--input", inputPath, "--root-dir", root]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /preconditionArtifact_sha256_must_match_active_v2/);
    await assertNoReceiptsWritten(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("basisFingerprint mismatch rejects", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "p-stale-cli-fingerprint-"));
  try {
    const inputPath = await writeInputFile(root, {
      ...buildValidInput(),
      runIdentity: {
        ...buildValidInput().runIdentity,
        basisFingerprint: "b".repeat(64),
      },
    });
    const result = runCli(["--input", inputPath, "--root-dir", root]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /basisFingerprint_must_match_active_v2_sha256/);
    await assertNoReceiptsWritten(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fixtureVersion replacement attempt cannot affect persisted run identity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "p-stale-cli-fixture-"));
  try {
    const inputPath = await writeInputFile(root, {
      ...buildValidInput(),
      runIdentity: {
        ...buildValidInput().runIdentity,
        fixtureVersion: "g0/P-crop/v1",
      },
    });
    const write = runCli(["--input", inputPath, "--root-dir", root, "--write"]);
    assert.equal(write.status, 0);
    const recordPath = write.stdout
      .split("\n")
      .find((line) => line.startsWith("record_path="))
      ?.replace("record_path=", "")
      .trim();
    assert.ok(recordPath);
    const persisted = JSON.parse(await readFile(recordPath!, "utf8")) as G0ObservedRunRecord;
    assert.equal(persisted.runMetadata.runIdentity.fixtureVersion, FIXTURE.fixtureVersion);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fixed P-stale fields remain forced, emittedResult is null, and pass checks stay required/passed", async () => {
  const parsed = await parsePStaleObservedRunWriterInput(buildValidInput(), ACTIVE_BINDING);
  const runMetadata = await buildPStaleRunMetadata(parsed);
  const record = buildPStaleObservedRunRecord({
    fixtureReceipt: FIXTURE,
    runMetadata,
    parsedInput: parsed,
  });

  assert.equal(record.probeId, "P-stale");
  assert.equal(record.probePackageVersion, "b3h-b2i-g0-v1");
  assert.equal(record.primaryObservation.observationKind, "derived_containment_conclusion");
  assert.equal(record.primaryObservation.observedPipelineStage, "live frame-state transition");
  assert.equal(record.primaryObservation.observedOperationalState, "calibration_not_attempted");
  assert.equal(record.primaryObservation.emittedResult, null);
  assert.equal(record.primaryObservation.derivedContainmentConclusion, FIXTURE.expectedRefusalOrContainmentResult);
  assert.equal(record.incidentReference, null);
  assert.deepEqual(record.supportingHarnessChecks, [
    {
      checkId: "shouldDropAuthorityOnFrameChange_predicate",
      required: true,
      status: "passed",
      failureClass: null,
    },
    {
      checkId: "precondition_artifact_readouts",
      required: true,
      status: "passed",
      failureClass: null,
    },
  ]);
  assert.deepEqual(await validateBenchmarkRunReceiptMetadata(runMetadata), { ok: true });
  assert.deepEqual(
    await validateG0ObservedRunRecord({
      fixtureReceipt: FIXTURE,
      record,
    }),
    { ok: true }
  );
});

test("malformed JSON and invalid dimensions fail with no output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "p-stale-cli-malformed-"));
  try {
    const malformedPath = path.join(root, "broken.json");
    await writeFile(malformedPath, "{ malformed ", "utf8");
    const malformed = runCli(["--input", malformedPath, "--root-dir", root]);
    assert.equal(malformed.status, 1);
    assert.match(malformed.stderr, /invalid_json/);
    await assertNoReceiptsWritten(root);

    const invalidInputPath = await writeInputFile(root, {
      ...buildValidInput(),
      baselineFrame: {
        width: 0,
        height: 698,
        rawObservationReference: "artifact://baseline",
      },
    });
    const invalid = runCli(["--input", invalidInputPath, "--root-dir", root]);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /invalid_baselineFrame_width/);
    await assertNoReceiptsWritten(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dry run creates no output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "p-stale-cli-dry-"));
  try {
    const inputPath = await writeInputFile(root, buildValidInput());
    const dry = runCli(["--input", inputPath, "--root-dir", root]);
    assert.equal(dry.status, 0);
    assert.match(dry.stdout, /mode=dry-run/);
    await assertNoReceiptsWritten(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("write creates one immutable temp-root record, re-read validation succeeds, repeat write fails", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "p-stale-cli-write-"));
  try {
    const inputPath = await writeInputFile(root, buildValidInput());
    const first = runCli(["--input", inputPath, "--root-dir", root, "--write"]);
    assert.equal(first.status, 0);
    assert.match(first.stdout, /post_write_re_read_validation=passed/);
    const recordPath = first.stdout
      .split("\n")
      .find((line) => line.startsWith("record_path="))
      ?.replace("record_path=", "")
      .trim();
    assert.ok(recordPath);
    assert.ok(recordPath!.startsWith(root));
    assert.equal(recordPath!.includes(path.join(process.cwd(), "app/admin/3d-room-lab/g0-containment/receipts")), false);

    const persisted = JSON.parse(await readFile(recordPath!, "utf8")) as G0ObservedRunRecord;
    assert.deepEqual(
      await validateG0ObservedRunRecord({
        fixtureReceipt: FIXTURE,
        record: persisted,
      }),
      { ok: true }
    );

    const second = runCli(["--input", inputPath, "--root-dir", root, "--write"]);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /target_path_exists/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
