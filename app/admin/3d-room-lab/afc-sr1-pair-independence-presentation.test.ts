import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./ThreeRoomLab.tsx", import.meta.url),
  "utf8"
);
const start = source.indexOf("const pairIndependenceDiagnostics");
const end = source.indexOf("              };\n              return (", start);
const presentation = source.slice(start, end);

test("pair-independence presentation remains a dynamic, read-only observation", () => {
  assert.ok(start >= 0 && end > start);
  assert.match(presentation, /Pair independence diagnostics — observation only/);
  assert.match(presentation, /reader\.winningPair\.familyIndices/);
  assert.match(presentation, /isWinner\(pair\.familyIndices\)/);
  assert.match(presentation, /familyOrientationSummaries/);
  assert.match(presentation, /onUnionSupporterMidpoints/);
  assert.doesNotMatch(presentation, /\[\s*1\s*,\s*5\s*\]/);
  assert.doesNotMatch(presentation, /\bfetch\s*\(/);
  assert.doesNotMatch(presentation, /\bApply\b/);
});
