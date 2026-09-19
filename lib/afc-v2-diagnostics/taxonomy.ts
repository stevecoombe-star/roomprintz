/**
 * AFC QA issue taxonomy v1.
 *
 * Machine identity is the versioned code set. Labels live here, not in SQL,
 * so historical v1 rows stay valid if UI wording changes later.
 */

export const AFC_QA_ISSUE_TAXONOMY_VERSION = "afc-qa-issue-taxonomy/v1" as const;

export const AFC_QA_ISSUE_CODES = [
  "perspective_off",
  "wall_edges_unrecognized",
  "scale_incorrect",
  "other",
] as const;

export type AfcQaIssueTaxonomyVersion = typeof AFC_QA_ISSUE_TAXONOMY_VERSION;
export type AfcQaIssueCode = (typeof AFC_QA_ISSUE_CODES)[number];

export const AFC_QA_ISSUE_CODE_SET: ReadonlySet<AfcQaIssueCode> = new Set(
  AFC_QA_ISSUE_CODES,
);

export const AFC_QA_ISSUE_CODE_LABELS: Readonly<Record<AfcQaIssueCode, string>> = {
  perspective_off: "Perspective off",
  wall_edges_unrecognized: "Wall edges unrecognized",
  scale_incorrect: "Scale incorrect",
  other: "Other",
};

export type AfcQaIssueTaxonomyValidation =
  | {
      ok: true;
      version: AfcQaIssueTaxonomyVersion;
      codes: readonly AfcQaIssueCode[];
    }
  | {
      ok: false;
      reason: "empty_codes" | "unknown_code" | "unknown_taxonomy_version" | "invalid_codes";
    };

export function isAfcQaIssueCode(value: unknown): value is AfcQaIssueCode {
  return typeof value === "string" && AFC_QA_ISSUE_CODE_SET.has(value as AfcQaIssueCode);
}

export function validateAfcQaIssueTaxonomy(input: {
  version: unknown;
  codes: unknown;
}): AfcQaIssueTaxonomyValidation {
  if (input.version !== AFC_QA_ISSUE_TAXONOMY_VERSION) {
    return { ok: false, reason: "unknown_taxonomy_version" };
  }
  if (!Array.isArray(input.codes)) {
    return { ok: false, reason: "invalid_codes" };
  }
  if (input.codes.length === 0) {
    return { ok: false, reason: "empty_codes" };
  }
  const codes: AfcQaIssueCode[] = [];
  for (const code of input.codes) {
    if (!isAfcQaIssueCode(code)) {
      return { ok: false, reason: "unknown_code" };
    }
    codes.push(code);
  }
  return { ok: true, version: AFC_QA_ISSUE_TAXONOMY_VERSION, codes };
}
