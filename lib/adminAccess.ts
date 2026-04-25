function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function isAdminEmail(email: string | null | undefined): boolean {
  const configuredAdminEmail = normalizeEmail(process.env.VIBODE_ADMIN_EMAIL);
  if (!configuredAdminEmail) return false;
  return normalizeEmail(email) === configuredAdminEmail;
}
