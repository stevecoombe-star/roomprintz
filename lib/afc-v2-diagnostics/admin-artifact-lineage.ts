/**
 * AFR-3D read mapping for persisted artifact_lineage_decision JSON.
 *
 * Calls the production parser and emits a whitelist DTO. Does not replay
 * the reader or invent evidence for historical null rows.
 */

import {
  AFC_V2_ARTIFACT_LINEAGE_DIAGNOSTIC_SCHEMA_VERSION,
  isAfcV2ArtifactLineageRecorded,
  parseAfcV2ArtifactLineage,
} from "@/lib/afc-v2-production/artifact-lineage-diagnostic";

import {
  AFC_DIAGNOSTIC_ADMIN_ARTIFACT_LINEAGE_SCHEMA_VERSION,
  parseAfcDiagnosticAdminArtifactLineageDto,
  type AfcDiagnosticAdminArtifactLineage,
} from "./admin-artifact-lineage-dto";

function unreadable(): AfcDiagnosticAdminArtifactLineage {
  return Object.freeze({ kind: "unreadable" });
}

export function mapAfcDiagnosticAdminArtifactLineage(
  value: unknown,
): AfcDiagnosticAdminArtifactLineage {
  try {
    const parsed = parseAfcV2ArtifactLineage(value);
    if (!parsed.ok) return unreadable();
    if (parsed.decision === null) return null;
    if ("kind" in parsed.decision && parsed.decision.kind === "unsupported_schema") {
      return parseAfcDiagnosticAdminArtifactLineageDto({
        kind: "unsupported_schema",
        schemaVersion: parsed.decision.schemaVersion,
      });
    }
    if (!isAfcV2ArtifactLineageRecorded(parsed.decision)) return unreadable();
    if (parsed.decision.schemaVersion !== AFC_V2_ARTIFACT_LINEAGE_DIAGNOSTIC_SCHEMA_VERSION) {
      return unreadable();
    }
    return parseAfcDiagnosticAdminArtifactLineageDto({
      kind: "recorded",
      schemaVersion: AFC_DIAGNOSTIC_ADMIN_ARTIFACT_LINEAGE_SCHEMA_VERSION,
      value: {
        empty: parsed.decision.empty,
        tiled: parsed.decision.tiled,
        reader: parsed.decision.reader,
      },
    });
  } catch {
    return unreadable();
  }
}
