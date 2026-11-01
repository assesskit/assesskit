import { DataError } from "@assesskit/runtime/errors";
import type { StylesheetFetch } from "../roots/index.js";
import type { Lexicon } from "../speech/index.js";

/** What the lexicons of the shell need of the player. */
export interface LexiconsContext {
  /** Loads a lexicon from the gate; `fetch` of the page fits. */
  readonly fetch: StylesheetFetch;
  /** Turns the path of a file in the package into a URL under a signed prefix. */
  readonly assets: (path: string) => string;
  /** Receives the lexicons of the item that is shown, in the order of its dependencies. */
  readonly apply: (lexicons: readonly Lexicon[]) => void;
}

/** The pronunciation lexicons of the item presented, loaded from the package. */
export interface Lexicons {
  /**
   * Loads the lexicons at the given paths, which the documents of a view name, and hands them over once they are loaded.
   *
   * @remarks
   * The same paths as the last call change nothing, and a lexicon is read once. A lexicon that is missing or is not a PLS
   * document is left out, so that reading aloud goes on without it.
   *
   * @param paths - The paths in the package of the lexicons, in the order of the dependencies.
   */
  follow(paths: readonly string[]): void;
}

/**
 * Creates the loader of the pronunciation lexicons that reading aloud uses.
 *
 * @remarks
 * The lexicons are files of the package, loaded through the gate like the module resolution files of a portable custom
 * interaction. The code that reads them loads with the first lexicon.
 *
 * @param context - See {@link LexiconsContext}.
 * @returns The loader.
 */
export function createLexicons(context: LexiconsContext): Lexicons {
  const { fetch, assets, apply } = context;
  const loaded = new Map<string, Promise<Lexicon | undefined>>();
  let current = "";

  const read = async (path: string): Promise<Lexicon | undefined> => {
    const response = await fetch(assets(path), { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) return undefined;
    // The reader holds an XML parser, which only an item that depends on a lexicon needs, so it loads when the first one does.
    const { parseLexicon } = await import("../speech/index.js");
    try {
      return parseLexicon(await response.text());
    } catch (error) {
      if (error instanceof DataError) return undefined;
      throw error;
    }
  };
  const lexiconAt = (path: string): Promise<Lexicon | undefined> => {
    let known = loaded.get(path);
    if (known === undefined) {
      known = read(path);
      loaded.set(path, known);
      // A failure of the network is tried again with the next item.
      known.catch(() => loaded.delete(path));
    }
    return known;
  };

  return {
    follow: (paths) => {
      const key = paths.join("\n");
      if (key === current) return;
      current = key;
      void Promise.allSettled(paths.map(lexiconAt)).then((results) => {
        if (key !== current) return;
        for (const result of results) if (result.status === "rejected") reportError(result.reason);
        apply(
          results.flatMap((result) =>
            result.status === "fulfilled" && result.value !== undefined ? [result.value] : [],
          ),
        );
      });
    },
  };
}
