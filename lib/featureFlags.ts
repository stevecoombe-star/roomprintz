// lib/featureFlags.ts
export function isFreezeV2Enabled(): boolean {
    // Vercel/Node env, Next server routes, etc.
    const v = process.env.VIBODE_FREEZE_V2;
  
    // Interpret "1", "true", "yes" as enabled
    if (!v) return false;
    return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
  }
  