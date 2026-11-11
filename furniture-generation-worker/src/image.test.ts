/**
 * Worker image configuration. This reads the Dockerfile. It does not build
 * or start a container and it does not call Meshy.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the generation image stays fake, idle, and off the Next.js server", () => {
  const source = readFileSync("furniture-generation-worker/Dockerfile", "utf8");
  assert.match(source, /^FROM node:22-bookworm-slim$/m);
  assert.match(source, /^WORKDIR \/app$/m);
  assert.match(source, /^RUN npm ci$/m);
  assert.match(source, /^ENV VIBODE_FURNITURE_GENERATION_PROVIDER=fake$/m);
  assert.match(source, /^ENV VIBODE_FURNITURE_GENERATION_WORKER_ENABLED=false$/m);
  assert.match(source, /^ENV VIBODE_MESHY_GENERATION_ENABLED=false$/m);
  assert.match(source, /^ENV VIBODE_FURNITURE_GENERATION_CLEANUP_ENABLED=false$/m);
  assert.match(
    source,
    /^CMD \["node", "--conditions=react-server", "--import", "tsx", "furniture-generation-worker\/src\/index.ts"\]$/m,
  );
  assert.doesNotMatch(source, /^EXPOSE /m);
  assert.doesNotMatch(source, /^HEALTHCHECK /m);
  assert.doesNotMatch(source, /^ENV MESHY_API_KEY/m);
  assert.doesNotMatch(source, /VIBODE_CLEANUP_WORKER_ENABLED|VIBODE_HARMONIZE_WORKER_ENABLED|GEMINI_API_KEY/);
  assert.doesNotMatch(source, /next start|npm start|next dev/);
  assert.doesNotMatch(source, /^COPY \.env/m);
});
