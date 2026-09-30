/**
 * Geometry authorities the calibrated-camera freeze gate may accept.
 * A manual quad is human evidence. It must not be recorded as a TILED read.
 */

export const TILED_PERSPECTIVE_READER_GEOMETRY_AUTHORITY =
  "tiled_perspective_reader" as const;
export const TILED_PERSPECTIVE_READER_VERSION =
  "afc-sr1-tiled-perspective-reader/s1" as const;
export const MANUAL_SOURCE_QUAD_GEOMETRY_AUTHORITY =
  "manual_source_quad" as const;
export const MANUAL_SOURCE_QUAD_GEOMETRY_VERSION =
  "manual-source-quad/v1" as const;

export type AcceptedAfcGeometryAuthority =
  | typeof TILED_PERSPECTIVE_READER_GEOMETRY_AUTHORITY
  | typeof MANUAL_SOURCE_QUAD_GEOMETRY_AUTHORITY;

export type AcceptedAfcGeometryReaderVersion =
  | typeof TILED_PERSPECTIVE_READER_VERSION
  | typeof MANUAL_SOURCE_QUAD_GEOMETRY_VERSION;

export function acceptedAfcGeometryAuthority(
  geometryAuthority: unknown,
  readerVersion: unknown,
): geometryAuthority is AcceptedAfcGeometryAuthority {
  return (
    (geometryAuthority === TILED_PERSPECTIVE_READER_GEOMETRY_AUTHORITY &&
      readerVersion === TILED_PERSPECTIVE_READER_VERSION) ||
    (geometryAuthority === MANUAL_SOURCE_QUAD_GEOMETRY_AUTHORITY &&
      readerVersion === MANUAL_SOURCE_QUAD_GEOMETRY_VERSION)
  );
}

export function recordedGeometryReaderVersion(
  geometryAuthority: AcceptedAfcGeometryAuthority,
): AcceptedAfcGeometryReaderVersion {
  return geometryAuthority === MANUAL_SOURCE_QUAD_GEOMETRY_AUTHORITY
    ? MANUAL_SOURCE_QUAD_GEOMETRY_VERSION
    : TILED_PERSPECTIVE_READER_VERSION;
}
