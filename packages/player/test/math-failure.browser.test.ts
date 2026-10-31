import { AssesskitError, DataError } from "@assesskit/runtime/errors";
import { describe, expect, inject, it } from "vitest";
import { createMathTypesetter } from "../src/player/index.js";
import { mount } from "./css-fixture.js";

const { asset } = inject("fixtures");

/** The browsers of a run share the servers, so this file names its paths with a token of its own. */
const TOKEN = crypto.randomUUID();
const MATHML = 'xmlns="http://www.w3.org/1998/Math/MathML"';
const EXPRESSION = `<p><math ${MATHML}><mi>x</mi><mo>+</mo><mn>1</mn></math></p>`;

/** This file runs in a page of its own, because MathJax is a global of the page and a failure to load it is final. */
describe("createMathTypesetter when MathJax cannot be loaded", () => {
  it("leaves the MathML in place and rejects when the URL has no script, without asking again", async () => {
    const typesetter = createMathTypesetter(`${asset}/mathjax/${TOKEN}/missing.js`);
    const content = mount(EXPRESSION);
    await expect(typesetter.typeset(content.root)).rejects.toThrow(AssesskitError);
    await expect(typesetter.typeset(content.root)).rejects.toThrow(/could not be loaded/u);
    expect(content.root.querySelector("math")).not.toBeNull();
    expect(content.root.querySelector("mjx-container")).toBeNull();
    const paths: string[] = await (await fetch(`${asset}/__hits`, { cache: "no-store" })).json();
    expect(paths.filter((path) => path.endsWith(`/${TOKEN}/missing.js`))).toHaveLength(1);
  });

  it("refuses a second URL, because MathJax is one global of the page", async () => {
    const typesetter = createMathTypesetter(`${asset}/mathjax/${TOKEN}/other.js`);
    await expect(typesetter.typeset(mount(EXPRESSION).root)).rejects.toThrow(DataError);
    await expect(typesetter.typeset(mount(EXPRESSION).root)).rejects.toThrow(/missing\.js/u);
  });

  it("still requests nothing for content without MathML after a failure", async () => {
    const typesetter = createMathTypesetter(`${asset}/mathjax/${TOKEN}/other.js`);
    await expect(typesetter.typeset(mount("<p>Words.</p>").root)).resolves.toBeUndefined();
  });
});
