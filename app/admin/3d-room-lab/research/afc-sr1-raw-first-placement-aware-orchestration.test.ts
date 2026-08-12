/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canonicalizeRfc8785Jcs,
  sha256HexUtf8,
} from "../gemini-evidence-contract";
import {
  buildAfcSr1BasisBoundSourcePolygon,
} from "./afc-sr1-basis-bound-source-polygon";
import {
  buildAfcSr1CommonBasisTr0Handoff,
} from "./afc-sr1-common-basis-tr0-handoff";
import {
  deriveAfcSr1FloorVanishingLineCrossRoom,
} from "./afc-sr1-floor-vanishing-line-cross-room";
import {
  buildAfcSr1PlacementBoundTr0Handoff,
} from "./afc-sr1-placement-bound-tr0-handoff";
import {
  AFC_SR1_RAW_FIRST_PLACEMENT_AWARE_ORCHESTRATION_POLICY_VERSION,
  AFC_SR1_RAW_FIRST_PLACEMENT_AWARE_ORCHESTRATION_VERSION,
  AFC_SR1_V3_FALLBACK_ELIGIBLE_REASONS,
  AFC_SR1_V3_HARD_REJECTION_REASONS,
  classifyAfcSr1V3ReaderRejectionReason,
  executeAfcSr1RawFirstPlacementAwareOrchestration,
  type AfcSr1RawFirstPlacementAwareDependenciesV1,
  type AfcSr1RawFirstPlacementAwareOrchestrationInputV1,
} from "./afc-sr1-raw-first-placement-aware-orchestration";
import {
  classifyAfcR3cImagePairCompatibility,
} from "./afc-r3c-image-pair-compatibility";
import type {
  AfcSr1TileGridScaffoldResult,
} from "./afc-sr1-tile-grid-scaffold";

const fixtureDirectory = new URL(
  "./fixtures/afc-sr1-room-c-strict-semantic-handoff-control.v1/",
  import.meta.url
);
const control = JSON.parse(
  readFileSync(new URL("control.json", fixtureDirectory), "utf8")
) as any;
const placementControl = JSON.parse(readFileSync(
  new URL(
    "./fixtures/afc-sr1-room-c-placement-bound-control.v1.json",
    import.meta.url
  ),
  "utf8"
)) as any;
const lineageControl = JSON.parse(readFileSync(
  new URL(
    "./fixtures/afc-sr1-room-c-ts0-lineage-control.v1.json",
    import.meta.url
  ),
  "utf8"
)) as any;

type ChildLabel = "C-T1" | "C-T2" | "C-T3";

const parentBytes = readFileSync(new URL(
  control.authority.rawImage.fixtureFile,
  fixtureDirectory
));

function childBytes(label: ChildLabel): Uint8Array {
  return readFileSync(new URL(
    control.realCompositorV3Evidence[label].imageFixtureFile,
    fixtureDirectory
  ));
}

function scaffoldResult(label: ChildLabel): AfcSr1TileGridScaffoldResult {
  const bytes = childBytes(label);
  const metadata = lineageControl.results[label];
  return {
    status: "generated",
    input: structuredClone(lineageControl.parent),
    tiled: {
      base64: Buffer.from(bytes).toString("base64"),
      identity: structuredClone(metadata.child),
    },
    provenance: structuredClone(metadata.provenance),
    compatibility: classifyAfcR3cImagePairCompatibility(
      {
        fingerprint: lineageControl.parent.sha256,
        decodedWidth: lineageControl.parent.decodedWidth,
        decodedHeight: lineageControl.parent.decodedHeight,
        orientation: lineageControl.parent.orientation,
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

function input(
  overrides: Partial<AfcSr1RawFirstPlacementAwareOrchestrationInputV1> = {}
): AfcSr1RawFirstPlacementAwareOrchestrationInputV1 {
  return {
    parentImageBytes: parentBytes,
    parentImageIdentity: structuredClone(lineageControl.parent),
    basisBoundSourcePolygon: structuredClone(
      control.authority.basisBoundSourcePolygon
    ),
    truncatedAnchor: control.authority.truncatedAnchor,
    anchorAuthority: structuredClone(control.authority.anchorAuthority),
    ts0ScaffoldOptions: {
      resultAllowedHosts: [],
      maxOutputBytes: 32 * 1024 * 1024,
      fetchTimeoutMs: 1_000,
      allowLocalhostHttp: false,
      generationTimeoutMs: 1_000,
    },
    ...overrides,
  };
}

function rejectedReaderReceipt(
  source: any,
  reason: string
): any {
  const receipt = structuredClone(source);
  const preimage = JSON.parse(receipt.evidenceCanonicalJson);
  receipt.status = "rejected";
  receipt.reason = reason;
  delete receipt.floorVanishingLinePixel;
  preimage.status = "rejected";
  preimage.reason = reason;
  delete preimage.floorVanishingLinePixel;
  receipt.evidenceCanonicalJson = canonicalizeRfc8785Jcs(preimage);
  receipt.evidenceDigest.value =
    sha256HexUtf8(receipt.evidenceCanonicalJson);
  return receipt;
}

function rejectedPlacementReceipt(source: any): any {
  const receipt = structuredClone(source);
  receipt.status = "rejected";
  receipt.reason = "insufficient_correspondence";
  receipt.translationPx = null;
  receipt.H_norm = null;
  const {
    evidenceCanonicalJson: _canonical,
    evidenceDigest: _digest,
    elapsedMs: _elapsed,
    ...preimage
  } = receipt;
  receipt.evidenceCanonicalJson = canonicalizeRfc8785Jcs(preimage);
  receipt.evidenceDigest.value =
    sha256HexUtf8(receipt.evidenceCanonicalJson);
  return receipt;
}

type ObservedCounts = {
  rawReader: number;
  ts0: number;
  placement: number;
  childReader: number;
};

function dependencies(
  label: ChildLabel,
  rawReceipt: unknown,
  overrides: Partial<AfcSr1RawFirstPlacementAwareDependenciesV1> & {
    ts0Result?: AfcSr1TileGridScaffoldResult;
    placementReceipt?: unknown;
    childReceipt?: unknown;
  } = {}
): {
  observed: ObservedCounts;
  value: AfcSr1RawFirstPlacementAwareDependenciesV1;
} {
  const observed: ObservedCounts = {
    rawReader: 0,
    ts0: 0,
    placement: 0,
    childReader: 0,
  };
  const value: AfcSr1RawFirstPlacementAwareDependenciesV1 = {
    callRawReader: overrides.callRawReader ?? (async () => {
      observed.rawReader += 1;
      return structuredClone(rawReceipt);
    }),
    executeTs0: overrides.executeTs0 ?? (async (args) => {
      observed.ts0 += 1;
      assert.equal(
        args.empty.base64,
        Buffer.from(parentBytes).toString("base64")
      );
      assert.deepEqual(args.empty.identity, lineageControl.parent);
      return structuredClone(
        overrides.ts0Result ?? scaffoldResult(label)
      );
    }),
    callPlacement: overrides.callPlacement ?? (async (args) => {
      observed.placement += 1;
      assert.deepEqual(
        Buffer.from(args.parentImageBytes),
        Buffer.from(parentBytes)
      );
      assert.deepEqual(
        Buffer.from(args.childImageBytes),
        Buffer.from(childBytes(label))
      );
      assert.equal(
        args.policyVersion,
        "afc-sr1-ts0-child-projective-placement-policy/v1"
      );
      assert.equal(
        args.registrationExclusion.evidenceLabel,
        "STRICT_EMPTY_POLYGON_USED_AS_REGISTRATION_EXCLUSION_MASK_ONLY"
      );
      assert.deepEqual(
        args.registrationExclusion.polygon,
        control.authority.readerRoi.polygon
      );
      assert.deepEqual(
        args.registrationExclusion.polygon,
        control.authority.basisBoundSourcePolygon.polygon.map(
          ({ x, y }: { x: number; y: number }) => [x, y]
        )
      );
      return structuredClone(
        overrides.placementReceipt ??
          placementControl.placements[label].receipt
      );
    }),
    callChildReader: overrides.callChildReader ?? (async () => {
      observed.childReader += 1;
      return structuredClone(
        overrides.childReceipt ??
          control.realCompositorV3Evidence[label].receipt
      );
    }),
    buildCommonBasis: overrides.buildCommonBasis,
    deriveProjective: overrides.deriveProjective,
    buildPlacementBoundHandoff: overrides.buildPlacementBoundHandoff,
  };
  return { observed, value };
}

const usableRawReceipt =
  control.realCompositorV3Evidence["C-RAW"].receipt;

function syntheticRawRejection(reason = "no_stable_valid_pair"): any {
  return rejectedReaderReceipt(usableRawReceipt, reason);
}

test("Reader V3 fallback classification is closed over every canonical reason", () => {
  assert.deepEqual([...AFC_SR1_V3_FALLBACK_ELIGIBLE_REASONS], [
    "insufficient_segments",
    "no_stable_valid_pair",
    "degenerate_vanishing_line",
  ]);
  assert.deepEqual([...AFC_SR1_V3_HARD_REJECTION_REASONS], [
    "unsupported_policy_version",
    "invalid_input_image",
    "source_raster_too_large",
    "below_reference_analysis_long_edge",
    "invalid_roi",
    "impossible_eroded_roi",
  ]);
  for (const reason of AFC_SR1_V3_FALLBACK_ELIGIBLE_REASONS) {
    assert.equal(
      classifyAfcSr1V3ReaderRejectionReason(reason),
      "evidence_rejected_fallback_eligible"
    );
  }
  for (const reason of AFC_SR1_V3_HARD_REJECTION_REASONS) {
    assert.equal(
      classifyAfcSr1V3ReaderRejectionReason(reason),
      "hard_rejected"
    );
  }
  assert.equal(
    classifyAfcSr1V3ReaderRejectionReason("future_reader_reason"),
    "hard_rejected"
  );
});

test("every canonical/unknown V3 reason enforces the orchestration fallback boundary", async (context) => {
  for (const reason of [
    ...AFC_SR1_V3_FALLBACK_ELIGIBLE_REASONS,
    ...AFC_SR1_V3_HARD_REJECTION_REASONS,
    "future_reader_reason",
  ]) {
    await context.test(reason, async () => {
      const fallbackEligible =
        AFC_SR1_V3_FALLBACK_ELIGIBLE_REASONS.includes(
          reason as typeof AFC_SR1_V3_FALLBACK_ELIGIBLE_REASONS[number]
        );
      const harness = dependencies(
        "C-T1",
        syntheticRawRejection(reason),
        {
          executeTs0: async () => {
            harness.observed.ts0 += 1;
            return {
              status: "failure",
              code: "generation_failed",
              runId: "classification-only",
            };
          },
        }
      );
      const result =
        await executeAfcSr1RawFirstPlacementAwareOrchestration(
          input(),
          harness.value
        );
      assert.equal(
        result.rawAttempt.fallbackEligibilityClass,
        fallbackEligible
          ? "evidence_rejected_fallback_eligible"
          : "hard_rejected"
      );
      assert.equal(result.attemptCounts.ts0, fallbackEligible ? 1 : 0);
      assert.equal(harness.observed.ts0, fallbackEligible ? 1 : 0);
    });
  }
});

test("Room C natural RAW-direct short-circuits every fallback stage", async () => {
  const harness = dependencies("C-T1", usableRawReceipt);
  const result = await executeAfcSr1RawFirstPlacementAwareOrchestration(
    input(),
    harness.value
  );
  assert.equal(result.schemaVersion, AFC_SR1_RAW_FIRST_PLACEMENT_AWARE_ORCHESTRATION_VERSION);
  assert.equal(result.policyVersion, AFC_SR1_RAW_FIRST_PLACEMENT_AWARE_ORCHESTRATION_POLICY_VERSION);
  assert.equal(result.mode, "raw-direct");
  assert.equal(result.finalReason, null);
  assert.equal(result.rawAttempt.projective?.seamT, 0.7037731582393056);
  assert.equal(result.fallbackAttempt, null);
  assert.deepEqual(result.attemptCounts, {
    rawReader: 1,
    ts0: 0,
    placement: 0,
    childReader: 0,
    placementBoundHandoff: 0,
    tiledProjective: 0,
  });
  assert.deepEqual(harness.observed, {
    rawReader: 1,
    ts0: 0,
    placement: 0,
    childReader: 0,
  });
});

for (const label of ["C-T1", "C-T2", "C-T3"] as const) {
  test(`SYNTHETIC_RAW_REJECTION_BRANCH_INTEGRATION_CONTROL ${label} uses exactly one child`, async () => {
    const harness = dependencies(label, syntheticRawRejection());
    const result = await executeAfcSr1RawFirstPlacementAwareOrchestration(
      input(),
      harness.value
    );
    assert.equal(result.mode, "tiled-placement");
    assert.equal(result.finalReason, null);
    assert.equal(
      result.rawAttempt.fallbackEligibilityClass,
      "evidence_rejected_fallback_eligible"
    );
    assert.equal(result.rawAttempt.receipt?.reason, "no_stable_valid_pair");
    assert.ok(
      Math.abs(
        result.fallbackAttempt!.finalProjective!.seamT! -
        placementControl.placements[label].expectedSeamT
      ) <= 1e-15
    );
    assert.ok(
      Math.abs(
        result.fallbackAttempt!.finalProjective!.seamT! -
        placementControl.gt0SeamT
      ) <= placementControl.absoluteTolerance
    );
    assert.equal(
      result.fallbackAttempt?.childImageIdentity?.sha256,
      lineageControl.results[label].child.sha256
    );
    assert.deepEqual(result.attemptCounts, {
      rawReader: 1,
      ts0: 1,
      placement: 1,
      childReader: 1,
      placementBoundHandoff: 1,
      tiledProjective: 1,
    });
    assert.deepEqual(harness.observed, {
      rawReader: 1,
      ts0: 1,
      placement: 1,
      childReader: 1,
    });
  });
}

test("one immutable polygon and anchor authority object crosses RAW and placement branches", async () => {
  const orchestrationInput = input();
  let commonBasisSeen = false;
  let placementBoundSeen = false;
  let frozenPolygon: unknown;
  let frozenAnchorAuthority: unknown;
  const harness = dependencies(
    "C-T1",
    usableRawReceipt,
    {
      buildCommonBasis: (value) => {
        commonBasisSeen = true;
        frozenPolygon = value.basisBoundSourcePolygon;
        frozenAnchorAuthority = value.anchorAuthority;
        assert.notEqual(frozenPolygon, orchestrationInput.basisBoundSourcePolygon);
        assert.equal(Object.isFrozen(frozenPolygon), true);
        assert.equal(Object.isFrozen(value.basisBoundSourcePolygon.polygon), true);
        assert.equal(Object.isFrozen(frozenAnchorAuthority), true);
        assert.equal(value.truncatedAnchor, orchestrationInput.truncatedAnchor);
        return buildAfcSr1CommonBasisTr0Handoff(value);
      },
      deriveProjective: (value) => {
        if (!placementBoundSeen) {
          return { status: "rejected", reason: "track1a_rejected" };
        }
        return deriveAfcSr1FloorVanishingLineCrossRoom(value);
      },
      buildPlacementBoundHandoff: (value) => {
        placementBoundSeen = true;
        assert.equal(value.basisBoundSourcePolygon, frozenPolygon);
        assert.equal(value.truncatedAnchor, orchestrationInput.truncatedAnchor);
        assert.equal(value.anchorAuthority, frozenAnchorAuthority);
        return buildAfcSr1PlacementBoundTr0Handoff(value);
      },
    }
  );
  const result = await executeAfcSr1RawFirstPlacementAwareOrchestration(
    orchestrationInput,
    harness.value
  );
  assert.equal(result.mode, "tiled-placement");
  assert.equal(commonBasisSeen, true);
  assert.equal(placementBoundSeen, true);
});

test("Room C tiled controls pass independent physical and range evaluation bars", async () => {
  const seamValues: number[] = [];
  for (const label of ["C-T1", "C-T2", "C-T3"] as const) {
    const harness = dependencies(label, syntheticRawRejection());
    const result = await executeAfcSr1RawFirstPlacementAwareOrchestration(
      input(),
      harness.value
    );
    seamValues.push(result.fallbackAttempt!.finalProjective!.seamT!);
  }
  const expectedSeams = [
    0.6829563966393044,
    0.6944048106610431,
    0.6903817563795518,
  ];
  assert.ok(seamValues.every(
    (value, index) => Math.abs(value - expectedSeams[index]) <= 1e-15
  ));
  const expectedErrors = [
    0.02341393595945329,
    0.011965521937714607,
    0.015988576219205908,
  ];
  assert.ok(
    seamValues
      .map((value) => Math.abs(value - 0.7063703325987577))
      .every(
        (value, index) => Math.abs(value - expectedErrors[index]) <= 1e-15
      )
  );
  assert.ok(seamValues.every(
    (value) => Math.abs(value - 0.7063703325987577) <= 0.025
  ));
  assert.ok(
    Math.abs(
      Math.max(...seamValues) -
      Math.min(...seamValues) -
      0.011448414021738684
    ) <= 1e-15
  );
  assert.ok(Math.max(...seamValues) - Math.min(...seamValues) <= 0.030);
});

test("valid RAW authority plus downstream geometric rejection is fallback eligible", async () => {
  let projectiveCalls = 0;
  const harness = dependencies("C-T1", usableRawReceipt, {
    deriveProjective: (value) => {
      projectiveCalls += 1;
      return projectiveCalls === 1
        ? { status: "rejected", reason: "track1a_rejected" }
        : deriveAfcSr1FloorVanishingLineCrossRoom(value);
    },
  });
  const result = await executeAfcSr1RawFirstPlacementAwareOrchestration(
    input(),
    harness.value
  );
  assert.equal(result.mode, "tiled-placement");
  assert.equal(
    result.rawAttempt.fallbackEligibilityClass,
    "evidence_rejected_fallback_eligible"
  );
  assert.equal(result.rawAttempt.projective?.reason, "track1a_rejected");
  assert.equal(projectiveCalls, 2);
  assert.equal(harness.observed.ts0, 1);
});

test("A/B/D preserved classifications do not claim strict success", () => {
  const diagnostics = {
    "A RAW": classifyAfcSr1V3ReaderRejectionReason(
      "no_stable_valid_pair"
    ),
    "B RAW": classifyAfcSr1V3ReaderRejectionReason(
      "no_stable_valid_pair"
    ),
    "D downstream": "evidence_rejected_fallback_eligible",
  } as const;
  assert.deepEqual(diagnostics, {
    "A RAW": "evidence_rejected_fallback_eligible",
    "B RAW": "evidence_rejected_fallback_eligible",
    "D downstream": "evidence_rejected_fallback_eligible",
  });
  assert.equal(Object.values(diagnostics).includes("success" as never), false);
});

test("deterministic replay is exact for raw-direct, tiled-placement, and hard reject", async () => {
  const rawFirst = await executeAfcSr1RawFirstPlacementAwareOrchestration(
    input(),
    dependencies("C-T1", usableRawReceipt).value
  );
  const rawSecond = await executeAfcSr1RawFirstPlacementAwareOrchestration(
    input(),
    dependencies("C-T1", usableRawReceipt).value
  );
  assert.deepEqual(rawFirst, rawSecond);

  const tiledFirst = await executeAfcSr1RawFirstPlacementAwareOrchestration(
    input(),
    dependencies("C-T2", syntheticRawRejection()).value
  );
  const tiledSecond = await executeAfcSr1RawFirstPlacementAwareOrchestration(
    input(),
    dependencies("C-T2", syntheticRawRejection()).value
  );
  assert.deepEqual(tiledFirst, tiledSecond);

  const invalid = input({
    parentImageBytes: Uint8Array.from(parentBytes.subarray(0, 32)),
  });
  const hardFirst =
    await executeAfcSr1RawFirstPlacementAwareOrchestration(invalid);
  const hardSecond =
    await executeAfcSr1RawFirstPlacementAwareOrchestration(invalid);
  assert.deepEqual(hardFirst, hardSecond);
  for (const result of [rawFirst, tiledFirst, hardFirst]) {
    assert.equal(
      result.evidenceDigest.value,
      sha256HexUtf8(result.evidenceCanonicalJson)
    );
    assert.deepEqual(
      JSON.parse(result.evidenceCanonicalJson),
      JSON.parse(canonicalizeRfc8785Jcs({
        schemaVersion: result.schemaVersion,
        policyVersion: result.policyVersion,
        parentImageIdentity: result.parentImageIdentity,
        semanticPolygonIdentity: result.semanticPolygonIdentity,
        truncatedAnchor: result.truncatedAnchor,
        anchorAuthority: result.anchorAuthority,
        rawAttempt: result.rawAttempt,
        fallbackAttempt: result.fallbackAttempt,
        attemptCounts: result.attemptCounts,
        mode: result.mode,
        finalReason: result.finalReason,
      }))
    );
    assert.equal(Object.hasOwn(result, "elapsedMs"), false);
  }
});

test("semantic preflight hard failures execute no Reader, TS0, or placement", async (context) => {
  const invalidPolygon = structuredClone(
    control.authority.basisBoundSourcePolygon
  );
  invalidPolygon.evidenceDigest.value = "0".repeat(64);
  const wrongBasis = buildAfcSr1BasisBoundSourcePolygon({
    polygon: control.authority.basisBoundSourcePolygon.polygon,
    basis: {
      ...control.authority.basisBoundSourcePolygon.basis,
      fingerprint: "0".repeat(64),
    },
    provenance: control.authority.basisBoundSourcePolygon.provenance,
  });
  const cases: [string, AfcSr1RawFirstPlacementAwareOrchestrationInputV1][] = [
    ["invalid parent polygon", input({ basisBoundSourcePolygon: invalidPolygon })],
    ["parent bytes/basis mismatch", input({ basisBoundSourcePolygon: wrongBasis })],
    ["invalid anchor authority", input({
      anchorAuthority: {
        ...control.authority.anchorAuthority,
        kind: "invalid",
      },
    } as any)],
    ["anchor mismatch", input({
      anchorAuthority: {
        ...control.authority.anchorAuthority,
        truncatedAnchor: "NR",
      },
    })],
  ];
  for (const [name, invalidInput] of cases) {
    await context.test(name, async () => {
      const harness = dependencies("C-T1", usableRawReceipt);
      const result =
        await executeAfcSr1RawFirstPlacementAwareOrchestration(
          invalidInput,
          harness.value
        );
      assert.equal(result.mode, "rejected");
      assert.equal(result.finalReason, "invalid_orchestration_input");
      assert.deepEqual(result.attemptCounts, {
        rawReader: 0,
        ts0: 0,
        placement: 0,
        childReader: 0,
        placementBoundHandoff: 0,
        tiledProjective: 0,
      });
      assert.deepEqual(harness.observed, {
        rawReader: 0,
        ts0: 0,
        placement: 0,
        childReader: 0,
      });
    });
  }
});

test("all RAW hard failures prohibit TS0 fallback", async (context) => {
  const tampered = structuredClone(usableRawReceipt);
  tampered.evidenceDigest.value = "0".repeat(64);
  const cases: [string, unknown, Partial<AfcSr1RawFirstPlacementAwareDependenciesV1>, string][] = [
    ["tampered RAW receipt", tampered, {}, "raw_receipt_invalid"],
    ["unknown RAW reason", syntheticRawRejection("future_reason"), {}, "raw_reader_rejected"],
    ["hard canonical RAW reason", syntheticRawRejection("invalid_roi"), {}, "raw_reader_rejected"],
    ["RAW transport exception", null, {
      callRawReader: async () => {
        throw new Error("offline");
      },
    }, "transport_failure"],
    ["common-basis rejection", usableRawReceipt, {
      buildCommonBasis: () => ({
        status: "rejected",
        reason: "reader_basis_mismatch",
      }),
    }, "common_basis_rejected"],
  ];
  for (const [name, receipt, override, reason] of cases) {
    await context.test(name, async () => {
      const harness = dependencies("C-T1", receipt, override);
      const result =
        await executeAfcSr1RawFirstPlacementAwareOrchestration(
          input(),
          harness.value
        );
      assert.equal(result.mode, "rejected");
      assert.equal(result.finalReason, reason);
      assert.equal(result.attemptCounts.ts0, 0);
      assert.equal(result.attemptCounts.placement, 0);
      assert.equal(result.attemptCounts.childReader, 0);
      assert.equal(harness.observed.ts0, 0);
    });
  }
});

test("TS0 and lineage failures stop before placement", async (context) => {
  const wrongParent = structuredClone(scaffoldResult("C-T1")) as any;
  wrongParent.input.sha256 = "0".repeat(64);
  const wrongChild = structuredClone(scaffoldResult("C-T1")) as any;
  wrongChild.tiled.identity.sha256 = "0".repeat(64);
  const invalidLineage = structuredClone(scaffoldResult("C-T1")) as any;
  invalidLineage.provenance.generatorId = "invalid";
  const cases: [string, Partial<AfcSr1RawFirstPlacementAwareDependenciesV1> & {
    ts0Result?: AfcSr1TileGridScaffoldResult;
  }, string][] = [
    ["generation failed", {
      executeTs0: async () => ({
        status: "failure",
        code: "generation_failed",
        runId: "one-attempt",
      }),
    }, "ts0_generation_failed"],
    ["wrong TS0 parent", { ts0Result: wrongParent }, "ts0_lineage_invalid"],
    ["wrong TS0 child", { ts0Result: wrongChild }, "ts0_lineage_invalid"],
    ["invalid lineage", {
      ts0Result: invalidLineage,
    }, "ts0_lineage_invalid"],
  ];
  for (const [name, override, reason] of cases) {
    await context.test(name, async () => {
      const harness = dependencies(
        "C-T1",
        syntheticRawRejection(),
        override
      );
      const result =
        await executeAfcSr1RawFirstPlacementAwareOrchestration(
          input(),
          harness.value
        );
      assert.equal(result.finalReason, reason);
      assert.equal(result.attemptCounts.ts0, 1);
      assert.equal(result.attemptCounts.placement, 0);
      assert.equal(result.attemptCounts.childReader, 0);
      assert.equal(harness.observed.placement, 0);
    });
  }
});

test("placement failures stop before child V3 and never retry", async (context) => {
  const tampered = structuredClone(
    placementControl.placements["C-T1"].receipt
  );
  tampered.evidenceDigest.value = "0".repeat(64);
  const cases: [string, unknown, string][] = [
    ["tampered placement receipt", tampered, "placement_receipt_invalid"],
    [
      "placement pair mismatch",
      placementControl.placements["C-T2"].receipt,
      "placement_receipt_invalid",
    ],
    [
      "validated placement rejection",
      rejectedPlacementReceipt(
        placementControl.placements["C-T1"].receipt
      ),
      "placement_rejected",
    ],
  ];
  for (const [name, receipt, reason] of cases) {
    await context.test(name, async () => {
      const harness = dependencies(
        "C-T1",
        syntheticRawRejection(),
        { placementReceipt: receipt }
      );
      const result =
        await executeAfcSr1RawFirstPlacementAwareOrchestration(
          input(),
          harness.value
        );
      assert.equal(result.finalReason, reason);
      assert.deepEqual(result.attemptCounts, {
        rawReader: 1,
        ts0: 1,
        placement: 1,
        childReader: 0,
        placementBoundHandoff: 0,
        tiledProjective: 0,
      });
      assert.equal(harness.observed.childReader, 0);
    });
  }
});

test("child V3 failures stop before placement-bound handoff", async (context) => {
  const wrongChild = control.realCompositorV3Evidence["C-T2"].receipt;
  const rejectedChild = rejectedReaderReceipt(
    control.realCompositorV3Evidence["C-T1"].receipt,
    "no_stable_valid_pair"
  );
  const cases: [string, unknown, string][] = [
    ["wrong child V3 receipt", wrongChild, "tiled_reader_receipt_invalid"],
    ["child V3 rejected", rejectedChild, "tiled_reader_rejected"],
  ];
  for (const [name, receipt, reason] of cases) {
    await context.test(name, async () => {
      const harness = dependencies(
        "C-T1",
        syntheticRawRejection(),
        { childReceipt: receipt }
      );
      const result =
        await executeAfcSr1RawFirstPlacementAwareOrchestration(
          input(),
          harness.value
        );
      assert.equal(result.finalReason, reason);
      assert.equal(result.attemptCounts.childReader, 1);
      assert.equal(result.attemptCounts.placementBoundHandoff, 0);
      assert.equal(result.attemptCounts.tiledProjective, 0);
    });
  }
});

test("placement-bound and final projective rejections are terminal", async (context) => {
  await context.test("wrong reader child for placement", async () => {
    const harness = dependencies(
      "C-T1",
      syntheticRawRejection(),
      {
        buildPlacementBoundHandoff: () => ({
          status: "rejected",
          reason: "reader_child_basis_mismatch",
        }),
      }
    );
    const result =
      await executeAfcSr1RawFirstPlacementAwareOrchestration(
        input(),
        harness.value
      );
    assert.equal(result.finalReason, "placement_handoff_rejected");
    assert.equal(
      result.fallbackAttempt?.placementBoundHandoff?.reason,
      "reader_child_basis_mismatch"
    );
    assert.equal(result.attemptCounts.placementBoundHandoff, 1);
    assert.equal(result.attemptCounts.tiledProjective, 0);
  });

  await context.test("placement-bound handoff reject", async () => {
    const harness = dependencies(
      "C-T1",
      syntheticRawRejection(),
      {
        buildPlacementBoundHandoff: () => ({
          status: "rejected",
          reason: "parent_polygon_basis_mismatch",
        }),
      }
    );
    const result =
      await executeAfcSr1RawFirstPlacementAwareOrchestration(
        input(),
        harness.value
      );
    assert.equal(result.finalReason, "placement_handoff_rejected");
    assert.equal(result.attemptCounts.tiledProjective, 0);
  });

  await context.test("tiled TR0/Track 1a reject", async () => {
    const harness = dependencies(
      "C-T1",
      syntheticRawRejection(),
      {
        deriveProjective: () => ({
          status: "rejected",
          reason: "track1a_rejected",
        }),
      }
    );
    const result =
      await executeAfcSr1RawFirstPlacementAwareOrchestration(
        input(),
        harness.value
      );
    assert.equal(result.finalReason, "tiled_projective_rejected");
    assert.equal(
      result.fallbackAttempt?.finalProjective?.reason,
      "track1a_rejected"
    );
    assert.equal(result.attemptCounts.tiledProjective, 1);
  });
});

test("new orchestration source is strictly contained and exposes no policy escape hatch", () => {
  const source = readFileSync(
    new URL(
      "./afc-sr1-raw-first-placement-aware-orchestration.ts",
      import.meta.url
    ),
    "utf8"
  );
  for (const forbidden of [
    "legacyUnboundTr0Handoff",
    "legacyUnboundProjectiveHandoff",
    "forceFallback",
    "skipRaw",
    "preferTile",
    "0.7063703325987577",
    "0.7037731582393056",
    "0.6829563966393044",
    "0.6944048106610431",
    "0.6903817563795518",
    "C-T1",
    "C-T2",
    "C-T3",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.equal(source.includes("tiled-fallback"), false);
});
