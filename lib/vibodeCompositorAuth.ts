export const VIBODE_COMPOSITOR_AUTH_HEADER = "X-Vibode-Compositor-Auth";

export function vibodeCompositorAuthHeader(): Record<string, string> {
  const secret = process.env.VIBODE_COMPOSITOR_AUTH_SECRET?.trim() ?? "";
  if (!secret) return {};
  return { [VIBODE_COMPOSITOR_AUTH_HEADER]: secret };
}

export function mergeVibodeCompositorAuth(
  headers: Record<string, string>
): Record<string, string> {
  return {
    ...headers,
    ...vibodeCompositorAuthHeader(),
  };
}
