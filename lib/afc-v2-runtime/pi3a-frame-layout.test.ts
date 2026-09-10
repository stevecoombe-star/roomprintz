import assert from "node:assert/strict";
import test from "node:test";

import { containFitRect, containRectAspect } from "./frame-layout";

test("letterbox/pillarbox preserves frozen-camera frame aspect", () => {
  const frame = { width: 1200, height: 800 };
  const letterbox = containFitRect(2000, 800, frame.width, frame.height);
  assert.ok(letterbox);
  assert.equal(containRectAspect(letterbox), 1200 / 800);
  assert.equal(letterbox.height, 800);
  assert.ok(letterbox.left > 0);
  assert.equal(letterbox.top, 0);

  const pillarbox = containFitRect(1200, 1200, frame.width, frame.height);
  assert.ok(pillarbox);
  assert.equal(containRectAspect(pillarbox), 1200 / 800);
  assert.equal(pillarbox.width, 1200);
  assert.ok(pillarbox.top > 0);
});
