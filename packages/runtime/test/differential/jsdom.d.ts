// The part of jsdom that the Amp-up runner uses. The types of jsdom (`@types/jsdom`) load the DOM library into the whole
// program, which the runtime must not see: it runs where there is no document.
declare module "jsdom" {
  /** A window without a screen. */
  interface Window {
    /** Runs a script in the window and returns its value as the type the caller expects. */
    eval<TValue = unknown>(script: string): TValue;
  }

  /** A document and its window. */
  export class JSDOM {
    constructor(html: string, options: { readonly runScripts: "outside-only"; readonly url: string });
    readonly window: Window;
  }
}
