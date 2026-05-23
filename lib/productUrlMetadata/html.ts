function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function parseMetaTagAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null = null;
  while ((match = attrRegex.exec(tag))) {
    const key = match[1].toLowerCase();
    const raw = match[3] ?? match[4] ?? match[5] ?? "";
    attrs[key] = raw.trim();
  }
  return attrs;
}

export function getMetaContent(
  html: string,
  checks: Array<{ key: "property" | "name" | "itemprop"; value: string }>
): string | null {
  const metaRegex = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = metaRegex.exec(html))) {
    const attrs = parseMetaTagAttributes(match[0]);
    const content = asOptionalString(attrs.content);
    if (!content) continue;
    const isMatch = checks.some(({ key, value }) => (attrs[key] ?? "").toLowerCase() === value);
    if (isMatch) return content;
  }
  return null;
}

export function getTitleFromHtml(html: string): string | null {
  const ogTitle = getMetaContent(html, [{ key: "property", value: "og:title" }]);
  if (ogTitle) return collapseWhitespace(decodeHtmlEntities(ogTitle));
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = asOptionalString(titleMatch?.[1] ?? null);
  return title ? collapseWhitespace(decodeHtmlEntities(title)) : null;
}
