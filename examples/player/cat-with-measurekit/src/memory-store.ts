import type { SectionStore, StoredSection } from "./section-store.ts";

/**
 * A section store in memory that keeps the JSON of what it is given, as a database would. A host that shares sections
 * between processes keeps them in its own database instead.
 */
export function memoryStore(): SectionStore & { readonly kept: Map<string, string> } {
  const kept = new Map<string, string>();
  return {
    kept,
    async put(identifier, section) {
      kept.set(identifier, JSON.stringify(section));
    },
    async get(identifier) {
      const text = kept.get(identifier);
      return text === undefined ? undefined : (JSON.parse(text) as StoredSection);
    },
  };
}
