import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PartnerModelDimensions } from "./PartnerModelDimensions";

test("product dimensions default to locked proportions and labelled fields", () => {
  const html = renderToStaticMarkup(createElement(PartnerModelDimensions, {
    native: { widthM: 0.78, heightM: 0.83, depthM: 0.84 },
    dimensions: null,
    onCommit: () => undefined,
  }));
  assert.match(html, /Detected model size/);
  assert.match(html, /W 0\.78 m × D 0\.84 m × H 0\.83 m/);
  assert.match(html, /Product dimensions/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /aria-label="Lock proportions"/);
  assert.match(html, />Width</);
  assert.match(html, />Depth</);
  assert.match(html, />Height</);
  assert.match(html, /value="0\.78"/);
  assert.match(html, /value="0\.84"/);
  assert.match(html, /value="0\.83"/);
  assert.match(html, /These dimensions determine the model&#x27;s physical size in Vibode\./);
  assert.doesNotMatch(html, /Edit dimensions independently/);
});
