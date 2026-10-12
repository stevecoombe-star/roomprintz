import { HARMONIZE_FAILURE_MESSAGE_MAX } from "./policy";

const PROMPT_MARKERS = [
  "Photorealistic Furniture Harmonization",
  "PRODUCT MATERIAL / FINISH REFERENCE",
];

/**
 * Diagnostics may keep a provider status and a short reason.
 * They never keep credentials, prompt text, or image bytes.
 */
export function redactHarmonizeDiagnostic(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  let cut = collapsed.length;
  for (const marker of PROMPT_MARKERS) {
    const index = collapsed.indexOf(marker);
    if (index >= 0) cut = Math.min(cut, index);
  }
  const sliced = collapsed
    .slice(0, cut)
    .replace(/AIza[0-9A-Za-z_-]{8,}/g, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]")
    .trim();
  return sliced.slice(0, HARMONIZE_FAILURE_MESSAGE_MAX);
}
