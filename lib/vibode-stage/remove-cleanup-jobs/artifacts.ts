export type CleanupArtifactStore = {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<"ok" | "failed">;
  get(path: string): Promise<Uint8Array | null>;
  remove(paths: readonly string[]): Promise<void>;
};

export function createMemoryCleanupArtifacts(): CleanupArtifactStore & {
  objects: Map<string, Uint8Array>;
} {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(path, bytes) {
      if (!safePath(path) || bytes.byteLength < 1) return "failed";
      objects.set(path, Uint8Array.from(bytes));
      return "ok";
    },
    async get(path) {
      if (!safePath(path)) return null;
      const stored = objects.get(path);
      return stored ? Uint8Array.from(stored) : null;
    },
    async remove(paths) {
      for (const path of paths) objects.delete(path);
    },
  };
}

export function safeCleanupObjectPath(path: string): boolean {
  return safePath(path);
}

function safePath(path: string): boolean {
  return path.startsWith("rooms/")
    && !path.includes("..")
    && !path.startsWith("/")
    && !path.includes("\\");
}
