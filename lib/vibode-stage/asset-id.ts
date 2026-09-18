/**
 * Browser-safe Asset / commercial ID helpers.
 *
 * Pure string checks only. Must not import Node filesystem, generated
 * registration, furniture-manifest IO, or server-only modules.
 */

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(value: string): boolean {
  return UUID_SHAPE.test(value);
}
