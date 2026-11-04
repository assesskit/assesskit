declare module "vitest" {
  interface ProvidedContext {
    /** The asset origin of the browser tests: the player's static files under `/static/`, a package under `/g/<token>/`. */
    assetOrigin: string;
  }
}

export {};
