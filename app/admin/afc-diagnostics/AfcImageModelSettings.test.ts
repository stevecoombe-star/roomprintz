import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import AfcImageModelSettings from "./AfcImageModelSettings";

test("AFC diagnostics image model controls render both selectors", () => {
  const html = renderToStaticMarkup(createElement(AfcImageModelSettings));
  assert.match(html, /AFC Image Models/);
  assert.match(html, /aria-label="AFC EMPTY image model"/);
  assert.match(html, /aria-label="AFC TILED image model"/);
  assert.match(html, /Nano Banana Pro/);
  assert.match(html, /GPT Image 2\.5 Sunburst High/);
  assert.doesNotMatch(html, /Nano Banana 2|OPENAI_API_KEY|sk-/);
});
