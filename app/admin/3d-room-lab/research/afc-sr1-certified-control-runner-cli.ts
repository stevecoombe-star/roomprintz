import "server-only";

import {
  AFC_SR1_CERTIFIED_PERMISSION_MODE,
  runAfcSr1CertifiedControl,
} from "./afc-sr1-certified-control-runner";

function parseArguments(argv: readonly string[]): Readonly<{
  executionDirectory: string;
  custodyDirectory: string;
  compositorRepository: string;
}> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !key ||
      !value ||
      ![
        "--execution-dir",
        "--custody-dir",
        "--compositor-repo",
      ].includes(key) ||
      values.has(key)
    ) {
      throw new Error(
        "Usage: --execution-dir <existing-dir> --custody-dir <existing-dir> --compositor-repo <repo>"
      );
    }
    values.set(key, value);
  }
  const executionDirectory = values.get("--execution-dir");
  const custodyDirectory = values.get("--custody-dir");
  const compositorRepository = values.get("--compositor-repo");
  if (!executionDirectory || !custodyDirectory || !compositorRepository) {
    throw new Error("All certified runner path arguments are required.");
  }
  return Object.freeze({
    executionDirectory,
    custodyDirectory,
    compositorRepository,
  });
}

function parseHosts(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === "") return Object.freeze([]);
  return Object.freeze(value.split(",").map((host) => host.trim()));
}

function parseLocalhost(value: string | undefined): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(
    "AFC_SR1_TS0_ALLOW_LOCALHOST_HTTP must be exactly true or false."
  );
}

async function main(): Promise<void> {
  const paths = parseArguments(process.argv.slice(2));
  const permissionMode =
    process.env.AFC_SR1_CERTIFIED_PERMISSION_MODE?.trim() ?? "";
  const invocationIdentity =
    process.env.AFC_SR1_CERTIFIED_INVOCATION_ID?.trim() ?? "";
  if (permissionMode !== AFC_SR1_CERTIFIED_PERMISSION_MODE) {
    throw new Error(
      `AFC_SR1_CERTIFIED_PERMISSION_MODE must be ${AFC_SR1_CERTIFIED_PERMISSION_MODE}.`
    );
  }
  const result = await runAfcSr1CertifiedControl({
    uiRepository: process.cwd(),
    compositorRepository: paths.compositorRepository,
    executionDirectory: paths.executionDirectory,
    custodyDirectory: paths.custodyDirectory,
    permissionMode,
    invocationIdentity,
    ts0ResultAllowedHosts: parseHosts(
      process.env.AFC_SR1_TS0_RESULT_ALLOWED_HOSTS
    ),
    ts0AllowLocalhostHttp: parseLocalhost(
      process.env.AFC_SR1_TS0_ALLOW_LOCALHOST_HTTP
    ),
  });
  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      artifactPath: result.artifactPath,
      custodyArtifactPath: result.custodyArtifactPath,
      canonicalByteLength: result.canonicalByteLength,
      sha256: result.sha256,
    })}\n`
  );
}

void main();
