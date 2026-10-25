export const VIBODE_COMPOSITOR_AUTH_HEADER = "X-Vibode-Compositor-Auth";

const UNCONFIGURED_MESSAGE = "VIBODE_COMPOSITOR_AUTH_SECRET is not configured.";

export class VibodeCompositorAuthConfigError extends Error {
  readonly code = "vibode_compositor_auth_unconfigured" as const;

  constructor() {
    super(UNCONFIGURED_MESSAGE);
    this.name = "VibodeCompositorAuthConfigError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isVibodeCompositorAuthConfigError(
  error: unknown
): error is VibodeCompositorAuthConfigError {
  return error instanceof VibodeCompositorAuthConfigError;
}

function configuredSecret(): string {
  const secret = process.env.VIBODE_COMPOSITOR_AUTH_SECRET?.trim() ?? "";
  if (!secret) throw new VibodeCompositorAuthConfigError();
  return secret;
}

function isCompositorAuthHeaderName(name: string): boolean {
  return name.toLowerCase() === VIBODE_COMPOSITOR_AUTH_HEADER.toLowerCase();
}

export function vibodeCompositorAuthHeader(): Record<string, string> {
  return { [VIBODE_COMPOSITOR_AUTH_HEADER]: configuredSecret() };
}

export function mergeVibodeCompositorAuth(
  headers: Record<string, string>
): Record<string, string> {
  const auth = vibodeCompositorAuthHeader();
  const merged: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (isCompositorAuthHeaderName(name)) continue;
    merged[name] = value;
  }
  return {
    ...merged,
    ...auth,
  };
}
