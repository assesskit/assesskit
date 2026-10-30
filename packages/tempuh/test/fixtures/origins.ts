/** The origins of the three servers that browser tests talk to. */
export interface FixtureOrigins {
  /** The asset origin: tempuh's static files under `/static/`, package files under `/g/<token>/`, and `/hang/<token>/`, which never answers. */
  readonly asset: string;
  /** Another origin that a test may allow, with a module under `/cdn/<token>/`. */
  readonly other: string;
  /** An origin that nothing may reach: every request to it is a leak. */
  readonly stranger: string;
}

declare module "vitest" {
  interface ProvidedContext {
    fixtures: FixtureOrigins;
  }
}
