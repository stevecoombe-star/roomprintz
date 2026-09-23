import assert from "node:assert/strict";
import test from "node:test";

import { containFitRect, containRectAspect, nextFrameBox } from "./frame-layout";

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

test("unchanged contain-fit geometry does not replace the frame box", () => {
  const measured = containFitRect(2000, 800, 1200, 800);
  assert.ok(measured);
  const first = nextFrameBox(null, measured);
  assert.equal(first, measured);
  assert.equal(first.width, measured.width);
  assert.equal(first.height, measured.height);
  assert.equal(first.left, measured.left);
  assert.equal(first.top, measured.top);

  const remeasured = containFitRect(2000, 800, 1200, 800);
  assert.ok(remeasured);
  assert.notEqual(remeasured, first);
  const second = nextFrameBox(first, remeasured);
  assert.equal(second, first);

  const resized = containFitRect(1200, 1200, 1200, 800);
  assert.ok(resized);
  const third = nextFrameBox(first, resized);
  assert.equal(third, resized);
  assert.notEqual(third, first);
});
