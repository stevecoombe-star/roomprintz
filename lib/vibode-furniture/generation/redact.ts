/**
 * Provider errors sometimes echo request bodies. Image data URIs and API
 * keys must not leave this module in a message, log, or thrown error.
 */

const DATA_URI = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi;
const MESHY_KEY = /\bmsy_[a-z0-9_-]+\b/gi;
const URL = /https?:\/\/\S+/gi;

export function redactSensitiveGenerationText(value: string): string {
  return value
    .replace(DATA_URI, "data:image/redacted")
    .replace(MESHY_KEY, "msy_redacted")
    .replace(URL, "[url]")
    .slice(0, 180);
}
