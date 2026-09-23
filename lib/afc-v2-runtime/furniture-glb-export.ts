/**
 * Node-only deterministic GLB export for synthetic furniture fixtures.
 * Production runtime does not import this module.
 */

import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

import { encodeGlb, glbBinaryChunk, inspectGlbJsonChunk } from "./glb-binary";
import { installNodeGltfFileReader } from "./node-gltf-file-reader";

installNodeGltfFileReader();

function stripNondeterministicJson(json: Record<string, unknown>): Record<string, unknown> {
  const next = { ...json };
  next.asset = { version: "2.0" };
  delete next.extras;
  delete next.extensions;
  return next;
}

export async function exportDeterministicGlb(object: THREE.Object3D): Promise<Uint8Array> {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(object, { binary: true });
  if (!(result instanceof ArrayBuffer)) {
    throw new Error("GLTFExporter did not return a binary GLB buffer.");
  }
  const bytes = new Uint8Array(result);
  const inspected = inspectGlbJsonChunk(bytes);
  if (!inspected.ok) {
    throw new Error(inspected.reason);
  }
  const json = stripNondeterministicJson(inspected.json as Record<string, unknown>);
  const bin = glbBinaryChunk(bytes);
  return encodeGlb(json, bin ?? undefined);
}
