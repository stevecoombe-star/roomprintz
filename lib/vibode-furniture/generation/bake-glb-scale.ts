/**
 * Bake one positive uniform scale into a GLB.
 *
 * Vertex positions, morph position deltas, node translations, and
 * translation animation outputs are scaled in place. Inverse-bind
 * translations are scaled the same way. Normals, UVs, texture bytes,
 * rotations, materials, and hierarchy are copied through.
 *
 * This does not run GLTFExporter. That path strips extensions and is not
 * the production intake encoder. Decoder extensions are refused rather
 * than rewritten.
 */

import {
  FURNITURE_ASSET_DECODER_EXTENSIONS,
} from "@/lib/afc-v2-runtime/furniture-asset-policy";
import {
  collectExternalUris,
  encodeGlb,
  glbBinaryChunk,
  inspectGlbJsonChunk,
} from "@/lib/afc-v2-runtime/glb-binary";

const FLOAT = 5126;
const DECODERS = new Set<string>(FURNITURE_ASSET_DECODER_EXTENSIONS);

type JsonObject = Record<string, unknown>;
type ScaleMode = "vec3" | "mat4-translation";

export type BakeScaleResult =
  | Readonly<{ ok: true; bytes: Uint8Array }>
  | Readonly<{ ok: false; code: "malformed" | "unsupported" | "invalid_scale" }>;

export function bakeUniformGlbScale(bytes: Uint8Array, factor: number): BakeScaleResult {
  if (!Number.isFinite(factor) || factor <= 0) return { ok: false, code: "invalid_scale" };
  const inspected = inspectGlbJsonChunk(bytes);
  if (!inspected.ok) return { ok: false, code: "malformed" };
  const sourceBin = glbBinaryChunk(bytes);
  if (!sourceBin) return { ok: false, code: "malformed" };
  if (collectExternalUris(inspected.json).length > 0) return { ok: false, code: "unsupported" };

  const doc = inspected.json as unknown as JsonObject;
  if (usesDecoder(doc)) return { ok: false, code: "unsupported" };
  const buffers = arrayAt(doc.buffers);
  const buffer = buffers && buffers.length === 1 ? objectAt(buffers[0]) : null;
  if (!buffer || buffer.uri != null) return { ok: false, code: "unsupported" };
  const byteLength = positiveInt(buffer.byteLength);
  if (byteLength == null || byteLength > sourceBin.byteLength) return { ok: false, code: "malformed" };

  const plan = new Map<number, ScaleMode>();
  if (!collectScalePlan(doc, plan)) return { ok: false, code: "unsupported" };
  const bin = Uint8Array.from(sourceBin);
  for (const [index, mode] of plan) {
    if (!scaleAccessor(doc, bin, index, mode, factor)) return { ok: false, code: "unsupported" };
  }
  if (!scaleNodeTranslations(doc, factor)) return { ok: false, code: "unsupported" };
  return { ok: true, bytes: encodeGlb(doc, bin) };
}

function collectScalePlan(doc: JsonObject, plan: Map<number, ScaleMode>): boolean {
  const meshes = arrayAt(doc.meshes) ?? [];
  let positions = 0;
  for (const meshValue of meshes) {
    const mesh = objectAt(meshValue);
    if (!mesh || decoderObject(mesh)) return false;
    for (const primitiveValue of arrayAt(mesh.primitives) ?? []) {
      const primitive = objectAt(primitiveValue);
      const attributes = primitive ? objectAt(primitive.attributes) : null;
      if (!primitive || !attributes || decoderObject(primitive)) return false;
      const position = indexAt(attributes.POSITION);
      if (position == null || !claim(plan, position, "vec3")) return false;
      positions += 1;
      for (const targetValue of arrayAt(primitive.targets) ?? []) {
        const target = objectAt(targetValue);
        if (!target) return false;
        if (target.POSITION == null) continue;
        const morph = indexAt(target.POSITION);
        if (morph == null || !claim(plan, morph, "vec3")) return false;
      }
    }
  }
  if (positions < 1) return false;

  for (const animationValue of arrayAt(doc.animations) ?? []) {
    const animation = objectAt(animationValue);
    if (!animation) return false;
    const samplers = arrayAt(animation.samplers) ?? [];
    for (const channelValue of arrayAt(animation.channels) ?? []) {
      const channel = objectAt(channelValue);
      const target = channel ? objectAt(channel.target) : null;
      const samplerIndex = channel ? indexAt(channel.sampler) : null;
      if (!channel || !target || samplerIndex == null) return false;
      const path = target.path;
      if (path === "rotation" || path === "scale" || path === "weights") continue;
      if (path !== "translation") return false;
      const sampler = objectAt(samplers[samplerIndex]);
      const output = sampler ? indexAt(sampler.output) : null;
      if (output == null || !claim(plan, output, "vec3")) return false;
    }
  }

  for (const skinValue of arrayAt(doc.skins) ?? []) {
    const skin = objectAt(skinValue);
    if (!skin) return false;
    if (skin.inverseBindMatrices == null) continue;
    const index = indexAt(skin.inverseBindMatrices);
    if (index == null || !claim(plan, index, "mat4-translation")) return false;
  }
  return true;
}

function claim(plan: Map<number, ScaleMode>, index: number, mode: ScaleMode): boolean {
  const existing = plan.get(index);
  if (existing != null) return existing === mode;
  plan.set(index, mode);
  return true;
}

function scaleNodeTranslations(doc: JsonObject, factor: number): boolean {
  for (const nodeValue of arrayAt(doc.nodes) ?? []) {
    const node = objectAt(nodeValue);
    if (!node) return false;
    if (node.translation != null && !scaleVec3Property(node, "translation", factor)) return false;
    if (node.matrix != null && !scaleMatrixTranslation(node, factor)) return false;
  }
  return true;
}

function scaleAccessor(
  doc: JsonObject,
  bin: Uint8Array,
  index: number,
  mode: ScaleMode,
  factor: number,
): boolean {
  const accessor = objectAt((arrayAt(doc.accessors) ?? [])[index]);
  if (!accessor || accessor.sparse != null || accessor.normalized === true) return false;
  if (accessor.componentType !== FLOAT) return false;
  if (mode === "vec3" && accessor.type !== "VEC3") return false;
  if (mode === "mat4-translation" && accessor.type !== "MAT4") return false;
  const view = objectAt((arrayAt(doc.bufferViews) ?? [])[indexAt(accessor.bufferView) ?? -1]);
  if (!view || view.buffer !== 0) return false;
  const count = positiveInt(accessor.count);
  const viewLength = positiveInt(view.byteLength);
  const viewOffset = optionalOffset(view.byteOffset);
  const accessorOffset = optionalOffset(accessor.byteOffset);
  if (count == null || viewLength == null || viewOffset == null || accessorOffset == null) return false;
  const components = mode === "vec3" ? 3 : 16;
  const elementBytes = components * 4;
  const stride = view.byteStride == null ? elementBytes : view.byteStride;
  if (typeof stride !== "number" || !Number.isInteger(stride) || stride < elementBytes || stride % 4 !== 0) {
    return false;
  }
  const start = viewOffset + accessorOffset;
  if (start % 4 !== 0 || start < viewOffset) return false;
  const end = start + (count - 1) * stride + elementBytes;
  if (end > viewOffset + viewLength || end > bin.byteLength) return false;

  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let element = 0; element < count; element += 1) {
    const offset = start + element * stride;
    if (mode === "vec3") {
      const scaled = [0, 1, 2].map((component) => data.getFloat32(offset + component * 4, true) * factor);
      if (scaled.some((value) => !Number.isFinite(value))) return false;
      scaled.forEach((value, component) => data.setFloat32(offset + component * 4, value, true));
      const x = data.getFloat32(offset, true);
      const y = data.getFloat32(offset + 4, true);
      const z = data.getFloat32(offset + 8, true);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    } else {
      for (const component of [12, 13, 14]) {
        const scaled = data.getFloat32(offset + component * 4, true) * factor;
        if (!Number.isFinite(scaled)) return false;
        data.setFloat32(offset + component * 4, scaled, true);
      }
    }
  }
  if (mode === "vec3") {
    accessor.min = [minX, minY, minZ];
    accessor.max = [maxX, maxY, maxZ];
  } else {
    delete accessor.min;
    delete accessor.max;
  }
  return true;
}

function scaleVec3Property(record: JsonObject, key: string, factor: number): boolean {
  const value = record[key];
  if (!Array.isArray(value) || value.length !== 3) return false;
  const scaled: number[] = [];
  for (const component of value) {
    if (typeof component !== "number" || !Number.isFinite(component)) return false;
    const next = component * factor;
    if (!Number.isFinite(next)) return false;
    scaled.push(next);
  }
  record[key] = scaled;
  return true;
}

function scaleMatrixTranslation(record: JsonObject, factor: number): boolean {
  const value = record.matrix;
  if (!Array.isArray(value) || value.length !== 16) return false;
  const scaled = value.map((component, index) => {
    if (typeof component !== "number" || !Number.isFinite(component)) return Number.NaN;
    return index === 12 || index === 13 || index === 14 ? component * factor : component;
  });
  if (scaled.some((component) => !Number.isFinite(component))) return false;
  record.matrix = scaled;
  return true;
}

function usesDecoder(doc: JsonObject): boolean {
  for (const key of ["extensionsUsed", "extensionsRequired"] as const) {
    if (doc[key] == null) continue;
    const names = arrayAt(doc[key]);
    if (!names || names.some((name) => typeof name !== "string")) return true;
    if (names.some((name) => DECODERS.has(name as string))) return true;
  }
  const collections = [
    arrayAt(doc.meshes) ?? [],
    arrayAt(doc.bufferViews) ?? [],
    arrayAt(doc.images) ?? [],
    arrayAt(doc.textures) ?? [],
    arrayAt(doc.materials) ?? [],
    arrayAt(doc.buffers) ?? [],
  ];
  for (const collection of collections) {
    for (const value of collection) {
      const record = objectAt(value);
      if (!record) continue;
      if (decoderObject(record)) return true;
      for (const primitive of arrayAt(record.primitives) ?? []) {
        const item = objectAt(primitive);
        if (item && decoderObject(item)) return true;
      }
    }
  }
  return false;
}

function decoderObject(record: JsonObject): boolean {
  const extensions = objectAt(record.extensions);
  if (!extensions) return false;
  return Object.keys(extensions).some((name) => DECODERS.has(name));
}

function objectAt(value: unknown): JsonObject | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function arrayAt(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function indexAt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function optionalOffset(value: unknown): number | null {
  if (value == null) return 0;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
