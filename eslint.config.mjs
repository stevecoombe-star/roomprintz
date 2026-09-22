import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local AFC research/capture artifacts (gitignored; not deployable).
    ".local/**",
  ]),
  // These named files are frozen SR1 certification/tamper tests using `any`
  // as an intentional mutation hatch. The waiver is file-specific; runtime
  // modules and any future research test stay under no-explicit-any.
  {
    files: [
      "app/admin/3d-room-lab/research/afc-sr1-basis-bound-source-polygon.test.ts",
      "app/admin/3d-room-lab/research/afc-sr1-certified-control-runner.test.ts",
      "app/admin/3d-room-lab/research/afc-sr1-common-basis-tr0-handoff.test.ts",
      "app/admin/3d-room-lab/research/afc-sr1-gemini-adapter.test.ts",
      "app/admin/3d-room-lab/research/afc-sr1-ground-truth.test.ts",
      "app/admin/3d-room-lab/research/afc-sr1-overlay-evidence.test.ts",
      "app/admin/3d-room-lab/research/afc-sr1-provider-replay.test.ts",
      "app/admin/3d-room-lab/research/afc-sr1-request-package.test.ts",
      "app/admin/3d-room-lab/research/afc-sr1-room-c-strict-semantic-handoff-control.test.ts",
      "app/admin/3d-room-lab/research/afc-sr1-semantic-prior-prompt.test.ts",
      "app/admin/3d-room-lab/research/afc-sr1-semantic-prior.test.ts",
      "app/admin/3d-room-lab/research/afc-sr1-tile-floor-reader-execution.test.ts",
      "app/admin/3d-room-lab/research/afc-sr1-tile-floor-reader-v3-execution.test.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
