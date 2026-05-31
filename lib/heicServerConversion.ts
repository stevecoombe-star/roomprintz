import type sharp from "sharp";

export type HeicConversionFailureCode =
  | "SHARP_UNAVAILABLE"
  | "LIBVIPS_HEIF_UNAVAILABLE"
  | "UNSUPPORTED_HEIC_CODEC"
  | "INVALID_HEIC_INPUT"
  | "UNKNOWN";

export class HeicConversionError extends Error {
  code: HeicConversionFailureCode;
  causeMessage: string | null;
  causeName: string | null;
  causeCode: string | null;
  causeStack: string | null;

  constructor(
    code: HeicConversionFailureCode,
    message: string,
    cause?: {
      message?: string | null;
      name?: string | null;
      code?: string | null;
      stack?: string | null;
    }
  ) {
    super(message);
    this.name = "HeicConversionError";
    this.code = code;
    this.causeMessage = cause?.message ?? null;
    this.causeName = cause?.name ?? null;
    this.causeCode = cause?.code ?? null;
    this.causeStack = cause?.stack ?? null;
  }
}

type ConversionArgs = {
  inputBuffer: Uint8Array;
};

type ConversionResult = {
  outputBuffer: Uint8Array;
  width: number | null;
  height: number | null;
};

type HeicConvertModuleShape = {
  default?: unknown;
};

type HeicConvertFn = (args: {
  buffer: Uint8Array;
  format: "JPEG";
  quality: number;
}) => Promise<Uint8Array | ArrayBuffer>;

function resolveErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === "string" ? maybeCode : null;
}

function classifyHeicConversionFailure(error: unknown): HeicConversionFailureCode {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (!message) return "UNKNOWN";
  if (message.includes("unsupported image format")) return "LIBVIPS_HEIF_UNAVAILABLE";
  if (message.includes("heif") && message.includes("support")) return "LIBVIPS_HEIF_UNAVAILABLE";
  if (message.includes("heic") && message.includes("codec")) return "UNSUPPORTED_HEIC_CODEC";
  if (message.includes("input buffer") || message.includes("corrupt") || message.includes("invalid")) {
    return "INVALID_HEIC_INPUT";
  }
  return "UNKNOWN";
}

function shouldTryFallbackAfterSharpError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (!message) return false;
  return (
    message.includes("heif") &&
    (message.includes("error while loading plugin") ||
      message.includes("compression format has not been built in") ||
      message.includes("unsupported compression") ||
      message.includes("unsupported codec") ||
      message.includes("not been built in"))
  );
}

function normalizeBinaryOutput(output: Uint8Array | ArrayBuffer): Uint8Array {
  if (output instanceof Uint8Array) return output;
  return new Uint8Array(output);
}

function getHeicConvertFn(module: unknown): HeicConvertFn | null {
  if (typeof module === "function") return module as HeicConvertFn;
  if (!module || typeof module !== "object") return null;
  const maybeDefault = (module as HeicConvertModuleShape).default;
  if (typeof maybeDefault === "function") return maybeDefault as HeicConvertFn;
  return null;
}

async function convertHeicViaFallback(inputBuffer: Uint8Array): Promise<Uint8Array> {
  const loadedModule = (await import("heic-convert")) as unknown;
  const convert = getHeicConvertFn(loadedModule);
  if (!convert) {
    throw new Error("Failed to load heic-convert fallback module.");
  }
  const output = await convert({
    buffer: inputBuffer,
    format: "JPEG",
    quality: 0.92,
  });
  return normalizeBinaryOutput(output);
}

export async function convertHeicBufferToJpeg(args: ConversionArgs): Promise<ConversionResult> {
  let sharpFactory: typeof sharp;
  try {
    const sharpModule = await import("sharp");
    sharpFactory = sharpModule.default;
  } catch (error) {
    throw new HeicConversionError(
      "SHARP_UNAVAILABLE",
      "sharp is not available in this runtime.",
      error instanceof Error
        ? {
            message: error.message,
            name: error.name,
            code: resolveErrorCode(error),
            stack: error.stack ?? null,
          }
        : {
            message: String(error),
          }
    );
  }

  let width: number | null = null;
  let height: number | null = null;

  try {
    const preflightMetadata = await sharpFactory(args.inputBuffer, { failOn: "none" }).metadata();
    width = preflightMetadata.width ?? null;
    height = preflightMetadata.height ?? null;
  } catch {
    // Metadata preflight is best-effort and non-fatal.
  }

  try {
    const outputBuffer = await sharpFactory(args.inputBuffer, { failOn: "none" })
      .rotate()
      .jpeg({
        quality: 92,
        mozjpeg: true,
      })
      .toBuffer();

    return {
      outputBuffer,
      width,
      height,
    };
  } catch (sharpError) {
    const code = classifyHeicConversionFailure(sharpError);
    const sharpMessage = sharpError instanceof Error ? sharpError.message : String(sharpError);
    if (shouldTryFallbackAfterSharpError(sharpError)) {
      console.warn("[heic-conversion] sharp failed; attempting fallback", {
        code,
        sharpMessage,
      });
      try {
        const fallbackOutputBuffer = await convertHeicViaFallback(args.inputBuffer);
        console.info("[heic-conversion] fallback conversion succeeded", {
          fallbackOutputBytes: fallbackOutputBuffer.length,
          width,
          height,
        });
        return {
          outputBuffer: fallbackOutputBuffer,
          width,
          height,
        };
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.error("[heic-conversion] fallback conversion failed", {
          sharpCode: code,
          sharpMessage,
          fallbackMessage,
        });
        throw new HeicConversionError(code, "Failed to convert HEIC/HEIF input to JPEG.", {
          message: `Sharp conversion failed: ${sharpMessage}; fallback conversion failed: ${fallbackMessage}`,
          name: fallbackError instanceof Error ? fallbackError.name : "FallbackConversionError",
          code: resolveErrorCode(fallbackError) ?? resolveErrorCode(sharpError),
          stack: fallbackError instanceof Error ? fallbackError.stack ?? null : null,
        });
      }
    }

    throw new HeicConversionError(
      code,
      "Failed to convert HEIC/HEIF input to JPEG.",
      sharpError instanceof Error
        ? {
            message: sharpError.message,
            name: sharpError.name,
            code: resolveErrorCode(sharpError),
            stack: sharpError.stack ?? null,
          }
        : {
            message: String(sharpError),
          }
    );
  }
}
