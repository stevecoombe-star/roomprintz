/**
 * Node FileReader polyfill for Three.js GLTFExporter.
 * Production runtime does not use this.
 */

class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
}

export function installNodeGltfFileReader(): void {
  if (typeof globalThis.FileReader !== "undefined") return;
  (globalThis as { FileReader: typeof NodeFileReader }).FileReader = NodeFileReader;
}
