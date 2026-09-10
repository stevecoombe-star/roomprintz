import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

const FORBIDDEN = [
  /collisionV1/,
  /editorStore/,
  /EditorCanvas/,
  /react-konva/,
  /from ["']konva["']/,
  /DEFAULT_PX_PER_IN/,
  /modelCalibrationAdapter/,
  /cameraBand/,
  /CalibratedRoomViewer/,
  /app\/admin\/3d-room-lab-v2/,
  /userWorldScale/,
  /computeMetricScale/,
  /lib\/collisionV1/,
];

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

test("production AFC runtime cannot import 2D or Lab-v1/v2 authority stacks", () => {
  const files = [
    ...walk(path.join(ROOT, "lib/afc-v2-runtime")),
    ...walk(path.join(ROOT, "components/afc-3d")),
    path.join(ROOT, "app/editor/afc-3d/page.tsx"),
    path.join(ROOT, "app/api/vibode/afc/runtime/route.ts"),
  ].filter((file) => !file.endsWith("pi3a-test-fixture.ts"));

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN) {
      assert.doesNotMatch(
        text,
        pattern,
        `${path.relative(ROOT, file)} matched ${pattern}`,
      );
    }
  }
});

test("PI-3A editor mount seam does not give editorStore world authority", () => {
  const editor = readFileSync(path.join(ROOT, "app/editor/page.tsx"), "utf8");
  assert.match(editor, /requestedAfc3dSurface/);
  assert.match(editor, /\/editor\/afc-3d\?roomId=/);
  const seam = editor.slice(
    editor.indexOf("requestedAfc3dSurface"),
    editor.indexOf("requestedAfc3dSurface") + 500,
  );
  assert.doesNotMatch(seam, /useEditorStore/);
});
