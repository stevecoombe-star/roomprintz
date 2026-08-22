export const P2_S2B_HOLDOUT_IDENTITY_VERSION =
  "p2-s2b-holdout-identity/v1" as const;
export const P2_S2B_HOLDOUT_CERTIFICATION_ROLE =
  "p2-s2b-blinded-holdout" as const;

export type P2S2BHoldoutIdentity = Readonly<{
  version: typeof P2_S2B_HOLDOUT_IDENTITY_VERSION;
  certificationRole: typeof P2_S2B_HOLDOUT_CERTIFICATION_ROLE;
  roomId: "room-b" | "room-d";
  emptySha256: string;
  emptyDimensions: Readonly<{ width: number; height: number }>;
  generatorId: string;
  manifestFileName: string;
  originalSha256: string;
  sourceIdentity: string;
}>;

export type P2S2BHoldoutIdentityParseResult =
  | Readonly<{ ok: true; identity: P2S2BHoldoutIdentity }>
  | Readonly<{ ok: false; reason: string }>;

const SHA_256 = /^[a-f0-9]{64}$/;
const SOURCE_IDENTITY =
  /^vibode-afc-r3c-fixed-inputs\/room-(b|d)\/room-(b|d)\.empty-room\.[a-f0-9]{64}\.png$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0;
}

/**
 * Strictly parses identity-only holdout cards. This contract has no field for
 * annotations, expected predictions, calibration, or any other oracle input.
 */
export function parseP2S2BHoldoutIdentity(
  value: unknown
): P2S2BHoldoutIdentityParseResult {
  if (!record(value) || !exactKeys(value, [
    "version",
    "certificationRole",
    "roomId",
    "emptySha256",
    "emptyDimensions",
    "generatorId",
    "manifestFileName",
    "originalSha256",
    "sourceIdentity",
  ])) {
    return { ok: false, reason: "holdout identity shape is invalid" };
  }
  if (
    value.version !== P2_S2B_HOLDOUT_IDENTITY_VERSION ||
    value.certificationRole !== P2_S2B_HOLDOUT_CERTIFICATION_ROLE ||
    (value.roomId !== "room-b" && value.roomId !== "room-d")
  ) {
    return { ok: false, reason: "holdout identity authority is invalid" };
  }
  if (
    typeof value.emptySha256 !== "string" ||
    !SHA_256.test(value.emptySha256) ||
    typeof value.originalSha256 !== "string" ||
    !SHA_256.test(value.originalSha256) ||
    typeof value.generatorId !== "string" ||
    value.generatorId.length === 0 ||
    value.manifestFileName !==
      `afc-r3c-${value.roomId}.image-manifest.v1.json` ||
    typeof value.sourceIdentity !== "string" ||
    !SOURCE_IDENTITY.test(value.sourceIdentity)
  ) {
    return { ok: false, reason: "holdout image identity is invalid" };
  }
  const sourceParts = value.sourceIdentity.split("/");
  if (
    sourceParts[1] !== value.roomId ||
    !sourceParts[2]?.startsWith(`${value.roomId}.empty-room.${value.emptySha256}`)
  ) {
    return { ok: false, reason: "holdout source identity is inconsistent" };
  }
  if (
    !record(value.emptyDimensions) ||
    !exactKeys(value.emptyDimensions, ["width", "height"]) ||
    !positiveInteger(value.emptyDimensions.width) ||
    !positiveInteger(value.emptyDimensions.height)
  ) {
    return { ok: false, reason: "holdout dimensions are invalid" };
  }
  return { ok: true, identity: value as P2S2BHoldoutIdentity };
}
