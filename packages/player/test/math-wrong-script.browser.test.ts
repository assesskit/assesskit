import { describe, expect, inject, it } from "vitest";
import { createMathTypesetter } from "../src/player/index.js";
import { mount } from "./css-fixture.js";

const { other } = inject("fixtures");

/** The browsers of a run share the servers, so this file names its paths with a token of its own. */
const TOKEN = crypto.randomUUID();

/** This file runs in a page of its own, because MathJax is a global of the page and a failure to load it is final. */
describe("createMathTypesetter with a script that is not MathJax", () => {
  it("rejects with an error that says what was expected, and leaves the MathML in place", async () => {
    const typesetter = createMathTypesetter(`${other}/cdn/${TOKEN}/not-mathjax.js`);
    const content = mount('<p><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></p>');
    await expect(typesetter.typeset(content.root)).rejects.toThrow(/not MathJax 4/u);
    expect(content.root.querySelector("math")).not.toBeNull();
  });
});
