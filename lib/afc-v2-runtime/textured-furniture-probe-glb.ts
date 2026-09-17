/**
 * Tiny deterministic textured GLB for Node parse regression.
 * Not a production Asset. Geometry is a 1 m triangle with an embedded PNG.
 */

import { encodeGlb } from "./glb-binary";

/** 1×1 opaque red PNG. */
const PNG_1X1_RED = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64",
  ),
);

export const TEXTURED_FURNITURE_PROBE_DECLARED_M = Object.freeze({
  widthM: 1,
  heightM: 1,
  depthM: 1,
});

export function encodeTexturedFurnitureProbeGlb(): Uint8Array {
  const positions = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 1,
  ]);
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    0, 1,
  ]);
  const posBytes = new Uint8Array(positions.buffer);
  const uvBytes = new Uint8Array(uvs.buffer);
  const png = PNG_1X1_RED;
  const bin = new Uint8Array(posBytes.byteLength + uvBytes.byteLength + png.byteLength);
  bin.set(posBytes, 0);
  bin.set(uvBytes, posBytes.byteLength);
  bin.set(png, posBytes.byteLength + uvBytes.byteLength);

  return encodeGlb(
    {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{
        primitives: [{
          attributes: { POSITION: 0, TEXCOORD_0: 1 },
          material: 0,
        }],
      }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: "VEC3",
          min: [0, 0, 0],
          max: [1, 1, 1],
        },
        {
          bufferView: 1,
          componentType: 5126,
          count: 3,
          type: "VEC2",
        },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: posBytes.byteLength },
        { buffer: 0, byteOffset: posBytes.byteLength, byteLength: uvBytes.byteLength },
        {
          buffer: 0,
          byteOffset: posBytes.byteLength + uvBytes.byteLength,
          byteLength: png.byteLength,
        },
      ],
      buffers: [{ byteLength: bin.byteLength }],
      images: [{ bufferView: 2, mimeType: "image/png" }],
      textures: [{ source: 0 }],
      materials: [{
        pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
      }],
    },
    bin,
  );
}

export function encodeUntexturedFurnitureProbeGlb(): Uint8Array {
  const positions = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 1,
  ]);
  const posBytes = new Uint8Array(positions.buffer);
  return encodeGlb(
    {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{
        primitives: [{ attributes: { POSITION: 0 } }],
      }],
      accessors: [{
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 1],
      }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: posBytes.byteLength }],
      buffers: [{ byteLength: posBytes.byteLength }],
    },
    posBytes,
  );
}
