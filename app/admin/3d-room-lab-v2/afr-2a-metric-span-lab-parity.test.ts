import assert from "node:assert/strict";
import test from "node:test";

import { containedDisplayFrame } from "./RoomLabV2";
import { OBSERVED_SPAN_IMAGE_SPACE } from "./observed-span-metric-candidate-contract";
import {
  AFC_DIAGNOSTIC_METRIC_SPAN_PATH_B_IMAGE_SPACE,
  metricSpanContainedDisplaySize,
  metricSpanContainedPixel,
  metricSpanViewBoxPoint,
} from "@/lib/afc-v2-diagnostics/admin-metric-span-overlay";

test("diagnostics contain-fit matches the Lab display frame for the same normalized endpoints", () => {
  const point = { x: 0.123, y: 0.842 };
  assert.deepEqual(metricSpanViewBoxPoint(point), point);
  const cases = [
    { container: { width: 900, height: 500 }, source: { width: 1200, height: 800 } },
    { container: { width: 300, height: 500 }, source: { width: 1200, height: 800 } },
    { container: { width: 640, height: 640 }, source: { width: 800, height: 1200 } },
  ];
  for (const { container, source } of cases) {
    const lab = containedDisplayFrame(container, source);
    assert.deepEqual(metricSpanContainedDisplaySize(container, source), lab);
    assert.deepEqual(metricSpanContainedPixel(point, container, source), {
      x: point.x * lab.width,
      y: point.y * lab.height,
    });
  }
  assert.equal(
    AFC_DIAGNOSTIC_METRIC_SPAN_PATH_B_IMAGE_SPACE,
    OBSERVED_SPAN_IMAGE_SPACE,
  );
  const pathB = { x: 0.21, y: 0.73 };
  assert.deepEqual(metricSpanViewBoxPoint(pathB), pathB);
});
