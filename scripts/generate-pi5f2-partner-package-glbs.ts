import path from "node:path";

import { writeFileAtomic } from "@/lib/afc-v2-runtime/furniture-asset-manifest";
import { exportDeterministicGlb } from "@/lib/afc-v2-runtime/furniture-glb-export";
import { createPi5f2DemoCoffeeTableObject3D } from "@/lib/afc-v2-runtime/pi5f2-demo-coffee-table-geometry";
import { createPi5f2DemoSideTableObject3D } from "@/lib/afc-v2-runtime/pi5f2-demo-side-table-geometry";

const PACKAGE_GLBS = path.join(
  process.cwd(),
  "lib/vibode-stage/partners/demo-furniture-co/pi5f2-tables/glbs",
);

async function main(): Promise<void> {
  const coffee = await exportDeterministicGlb(createPi5f2DemoCoffeeTableObject3D());
  const side = await exportDeterministicGlb(createPi5f2DemoSideTableObject3D());
  const coffeePath = path.join(PACKAGE_GLBS, "demo-coffee-table-v1.glb");
  const sidePath = path.join(PACKAGE_GLBS, "demo-side-table-v1.glb");
  writeFileAtomic(coffeePath, coffee);
  writeFileAtomic(sidePath, side);
  process.stdout.write(`wrote ${coffeePath} (${coffee.byteLength} bytes)\n`);
  process.stdout.write(`wrote ${sidePath} (${side.byteLength} bytes)\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
