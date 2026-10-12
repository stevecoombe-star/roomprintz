import { createHash } from "node:crypto";

import { readHarmonizeNbpImageSize } from "@/lib/vibode-stage/harmonize-nbp-proof";

import { HARMONIZE_OUTPUT_MAX_BYTES } from "./policy";
import { harmonizeProviderAcceptsOutput } from "./provider-capability";

export async function assessHarmonizeJobOutput(
  bytes: Uint8Array,
  inputWidth: number,
  inputHeight: number,
): Promise<
  | Readonly<{ ok: true; width: number; height: number; sha256: string; mime: "image/jpeg" }>
  | Readonly<{ ok: false; code: "unexpected_output" }>
> {
  if (bytes.byteLength === 0 || bytes.byteLength > HARMONIZE_OUTPUT_MAX_BYTES) {
    return { ok: false, code: "unexpected_output" };
  }
  const size = readHarmonizeNbpImageSize(bytes);
  if (!size || size.mime !== "image/jpeg") return { ok: false, code: "unexpected_output" };
  if (!harmonizeProviderAcceptsOutput({
    width: size.width,
    height: size.height,
    inputWidth,
    inputHeight,
  })) {
    return { ok: false, code: "unexpected_output" };
  }
  return {
    ok: true,
    width: size.width,
    height: size.height,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mime: "image/jpeg",
  };
}
