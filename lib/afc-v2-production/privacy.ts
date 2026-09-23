const FORBIDDEN_OBJECT_KEYS = new Set([
  "imageUrl",
  "image_url",
  "signedUrl",
  "signed_url",
  "overlay",
  "overlays",
  "prompt",
  "promptVersion",
  "promptText",
  "executionCounts",
  "freezeReceipt",
  "userWorldScale",
  "trustSelectedBackSpanAsFullWidth",
  "storagePath",
  "storage_path",
  "storageBucket",
  "storage_bucket",
  "emptyUrl",
  "tiledUrl",
  "adminUrl",
  "rawResponse",
  "receipt",
  "receipts",
  "diagnostic",
  "diagnostics",
  "diagnosticPayload",
  "attemptUrl",
  "sourceImageUrl",
]);

const FORBIDDEN_TEXT = [
  "/api/admin/",
  "storage/v1/object",
  "attempt-empty",
  "attempt-tiled",
  "X-Amz-Signature",
  "userWorldScale",
  "trustSelectedBackSpanAsFullWidth",
  "vibode.invalid",
  "vibode-afc-v2",
  "token=",
];

function walkForbiddenKeys(
  value: unknown,
  path: string,
  found: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      walkForbiddenKeys(entry, `${path}[${index}]`, found);
    });
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (FORBIDDEN_OBJECT_KEYS.has(key)) found.push(next);
    walkForbiddenKeys(child, next, found);
  }
}

export function collectProductionPayloadPrivacyViolations(
  payload: unknown,
): readonly string[] {
  const found: string[] = [];
  walkForbiddenKeys(payload, "", found);
  const serialized = JSON.stringify(payload) ?? "";
  for (const needle of FORBIDDEN_TEXT) {
    if (serialized.includes(needle)) {
      found.push(`text:${needle}`);
    }
  }
  if (/https?:\/\//i.test(serialized)) {
    found.push("text:url");
  }
  return Object.freeze(found);
}

export function assertProductionPayloadPrivacy(payload: unknown): void {
  const violations = collectProductionPayloadPrivacyViolations(payload);
  if (violations.length > 0) {
    throw new Error(
      `Production AFC payload leaked privileged fields: ${violations.join(", ")}`,
    );
  }
}
