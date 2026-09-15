/**
 * GLB container inspect/encode helpers for furniture Asset intake.
 *
 * Inspects the JSON chunk before Three.js parse. This is not a
 * general-purpose glTF editor.
 */

export const GLB_MAGIC = 0x46546C67;
export const GLB_JSON_CHUNK_TYPE = 0x4E4F534A;
export const GLB_BIN_CHUNK_TYPE = 0x004E4942;

export type GlbJsonDocument = {
  asset?: { version?: string };
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: Array<{
    name?: string;
    children?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    matrix?: number[];
    mesh?: number;
  }>;
  meshes?: unknown[];
  buffers?: Array<{ uri?: string; byteLength?: number }>;
  images?: Array<{ uri?: string; bufferView?: number }>;
  extensionsUsed?: string[];
  extensionsRequired?: string[];
};

export type GlbInspectResult =
  | Readonly<{
      ok: true;
      json: GlbJsonDocument;
      jsonBytes: Uint8Array;
      version: number;
      byteLength: number;
    }>
  | Readonly<{
      ok: false;
      reason: string;
      json: GlbJsonDocument | null;
    }>;

function pad4(bytes: Uint8Array, padByte: number): Uint8Array {
  const rem = bytes.byteLength % 4;
  if (rem === 0) return bytes;
  const padded = new Uint8Array(bytes.byteLength + (4 - rem));
  padded.set(bytes);
  padded.fill(padByte, bytes.byteLength);
  return padded;
}

export function encodeGlb(json: unknown, binary?: Uint8Array): Uint8Array {
  const jsonBytes = pad4(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const binBytes = binary ? pad4(binary, 0) : null;
  const total =
    12 +
    8 +
    jsonBytes.byteLength +
    (binBytes ? 8 + binBytes.byteLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.byteLength, true);
  view.setUint32(16, GLB_JSON_CHUNK_TYPE, true);
  out.set(jsonBytes, 20);
  if (binBytes) {
    const offset = 20 + jsonBytes.byteLength;
    view.setUint32(offset, binBytes.byteLength, true);
    view.setUint32(offset + 4, GLB_BIN_CHUNK_TYPE, true);
    out.set(binBytes, offset + 8);
  }
  return out;
}

export function inspectGlbJsonChunk(bytes: Uint8Array): GlbInspectResult {
  if (bytes.byteLength < 20) {
    return { ok: false, reason: "GLB header is truncated.", json: null };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== GLB_MAGIC) {
    return { ok: false, reason: "File is not a GLB container.", json: null };
  }
  const version = view.getUint32(4, true);
  if (version !== 2) {
    return { ok: false, reason: `Unsupported GLB version ${version}.`, json: null };
  }
  const length = view.getUint32(8, true);
  if (length !== bytes.byteLength) {
    return { ok: false, reason: "GLB length does not match file size.", json: null };
  }

  let offset = 12;
  let json: GlbJsonDocument | null = null;
  let jsonBytes: Uint8Array | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    if (dataEnd > bytes.byteLength) {
      return { ok: false, reason: "GLB chunk is truncated.", json };
    }
    if (chunkType === GLB_JSON_CHUNK_TYPE) {
      jsonBytes = bytes.subarray(dataStart, dataEnd);
      try {
        const text = new TextDecoder("utf-8").decode(jsonBytes).trim();
        json = JSON.parse(text) as GlbJsonDocument;
      } catch {
        return { ok: false, reason: "GLB JSON chunk is not valid JSON.", json: null };
      }
    }
    offset = dataEnd;
  }
  if (!json || !jsonBytes) {
    return { ok: false, reason: "GLB is missing a JSON chunk.", json: null };
  }
  return {
    ok: true,
    json,
    jsonBytes,
    version,
    byteLength: bytes.byteLength,
  };
}

export function isDataUri(uri: string): boolean {
  return uri.trim().toLowerCase().startsWith("data:");
}

export function collectExternalUris(json: GlbJsonDocument): string[] {
  const uris: string[] = [];
  for (const buffer of json.buffers ?? []) {
    if (typeof buffer.uri === "string" && buffer.uri.trim() && !isDataUri(buffer.uri)) {
      uris.push(buffer.uri);
    }
  }
  for (const image of json.images ?? []) {
    if (typeof image.uri === "string" && image.uri.trim() && !isDataUri(image.uri)) {
      uris.push(image.uri);
    }
  }
  return uris;
}

export function quaternionAngleDeg(rotation: readonly number[]): number {
  const w = rotation[3] ?? 1;
  const clamped = Math.min(1, Math.max(-1, w));
  return (2 * Math.acos(clamped) * 180) / Math.PI;
}

export function matrixLinearDet3(matrix: readonly number[]): number {
  const a00 = matrix[0] ?? 0;
  const a01 = matrix[4] ?? 0;
  const a02 = matrix[8] ?? 0;
  const a10 = matrix[1] ?? 0;
  const a11 = matrix[5] ?? 0;
  const a12 = matrix[9] ?? 0;
  const a20 = matrix[2] ?? 0;
  const a21 = matrix[6] ?? 0;
  const a22 = matrix[10] ?? 0;
  return (
    a00 * (a11 * a22 - a12 * a21) -
    a01 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * a21 - a11 * a20)
  );
}

export function matrixColumnScale(matrix: readonly number[]): {
  x: number;
  y: number;
  z: number;
} {
  const hypot = (a: number, b: number, c: number) => Math.hypot(a, b, c);
  return {
    x: hypot(matrix[0] ?? 0, matrix[1] ?? 0, matrix[2] ?? 0),
    y: hypot(matrix[4] ?? 0, matrix[5] ?? 0, matrix[6] ?? 0),
    z: hypot(matrix[8] ?? 0, matrix[9] ?? 0, matrix[10] ?? 0),
  };
}

export function matrixTranslation(matrix: readonly number[]): {
  x: number;
  y: number;
  z: number;
} {
  return {
    x: matrix[12] ?? 0,
    y: matrix[13] ?? 0,
    z: matrix[14] ?? 0,
  };
}
