import { describe, expect, it } from "vitest";
import { TempuhError } from "../src/index.js";
import { defineElements } from "../src/player/index.js";

// The registry of custom elements belongs to the page, so a name that another class holds is a state of a page of its own.
describe("defineElements", () => {
  it("[T26] refuses to take a name that another class holds, and defines nothing it was not asked to", () => {
    customElements.define("qti-slider-interaction", class extends HTMLElement {});
    expect(() => defineElements()).toThrow(
      new TempuhError("The name qti-slider-interaction is defined by another class."),
    );
  });
});
