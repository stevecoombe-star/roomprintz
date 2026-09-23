import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

import { createPi4aSofaObject3D } from "@/lib/afc-v2-runtime/pi4a-sofa-geometry";

const OUTPUT = path.join(
  process.cwd(),
  "public/afc-v2-runtime/test-fixtures/pi4a-sofa.glb",
);

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

if (typeof globalThis.FileReader === "undefined") {
  (globalThis as { FileReader: typeof NodeFileReader }).FileReader =
    NodeFileReader;
}

async function main(): Promise<void> {
  const sofa = createPi4aSofaObject3D();
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(sofa, { binary: true });
  if (!(result instanceof ArrayBuffer)) {
    throw new Error("GLTFExporter did not return a binary GLB buffer.");
  }
  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, Buffer.from(result));
  process.stdout.write(`wrote ${OUTPUT} (${result.byteLength} bytes)\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
