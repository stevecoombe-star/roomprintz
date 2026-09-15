import path from "node:path";

import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

import { installNodeGltfFileReader } from "@/lib/afc-v2-runtime/node-gltf-file-reader";
import { createPi5d2SideTableObject3D } from "@/lib/afc-v2-runtime/pi5d2-side-table-geometry";
import { writeFileAtomic } from "@/lib/afc-v2-runtime/furniture-asset-manifest";

installNodeGltfFileReader();

const OUTPUT = path.join(
  process.cwd(),
  "public/afc-v2-runtime/test-fixtures/pi5d2-side-table.glb",
);

async function main(): Promise<void> {
  const table = createPi5d2SideTableObject3D();
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(table, { binary: true });
  if (!(result instanceof ArrayBuffer)) {
    throw new Error("GLTFExporter did not return a binary GLB buffer.");
  }
  writeFileAtomic(OUTPUT, Buffer.from(result));
  process.stdout.write(`wrote ${OUTPUT} (${result.byteLength} bytes)\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
