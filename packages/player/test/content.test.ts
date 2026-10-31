import { DataError } from "@assesskit/runtime/errors";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EN_MESSAGES } from "../src/index.js";
import { createBodyRenderer } from "../src/player/content/index.js";
import {
  canAnimate,
  elementName,
  isHtmlName,
  isRasterDataUrl,
  readOrigins,
  resolveSrcset,
  resolveUrl,
  scaleSize,
  type UrlPolicy,
} from "../src/player/content/internal.js";

/** Passes input as JSON delivers it, which TypeScript does not check. */
const json = (text: string): unknown => JSON.parse(text);

const ASSETS = "https://assets.example/g/token/";
const policy: UrlPolicy = {
  assets: (path) => `${ASSETS}${path}`,
  base: "items/q1/item.xml",
  origins: new Set(["https://media.example"]),
};

describe("scaleSize", () => {
  it("multiplies a size in pixels and leaves any other length", () => {
    expect(scaleSize("200", 1.5)).toBe("300");
    expect(scaleSize("101", 1.5)).toBe("152");
    expect(scaleSize("50%", 2)).toBe("50%");
    expect(scaleSize("10em", 2)).toBe("10em");
    expect(scaleSize("200", 1)).toBe("200");
  });
});

describe("embed", () => {
  it("tells an image that can move by its media type, and without one by its extension", () => {
    for (const type of ["image/gif", "image/apng", "image/webp", "image/avif", "image/svg+xml", "IMAGE/GIF; q=1"]) {
      expect(canAnimate(type, "a"), type).toBe(true);
    }
    for (const type of ["image/png", "image/jpeg", "image/bmp"]) expect(canAnimate(type, "a.gif"), type).toBe(false);
    expect(canAnimate(undefined, "images/a.GIF?x=1")).toBe(true);
    expect(canAnimate(undefined, "images/a.png")).toBe(false);
    expect(canAnimate("", "images/a.webp#f")).toBe(true);
  });
});

describe("html-elements", () => {
  it("keeps the name of an HTML element and gives the elements of QTI the prefix qti-", () => {
    expect(elementName("p")).toBe("p");
    expect(elementName("table")).toBe("table");
    expect(elementName("choice-interaction")).toBe("qti-choice-interaction");
    expect(elementName("prompt")).toBe("qti-prompt");
    expect(isHtmlName("img")).toBe(true);
    expect(isHtmlName("qti-prompt")).toBe(false);
  });
});

describe("createBodyRenderer", () => {
  const valid = { messages: EN_MESSAGES, assets: policy.assets };
  const create = (options: unknown): unknown => createBodyRenderer(options as never);

  it("accepts the two required options and the optional ones", () => {
    expect(() => create(valid)).not.toThrow();
    expect(() =>
      create({
        ...valid,
        base: "items/q1/item.xml",
        origins: ["https://media.example"],
        interactions: new Map(),
        view: "scorer",
        withholdMedia: true,
        mediaScale: 1.5,
        variables: { outcomes: new Map(), templates: new Map() },
        fileUrl: () => "https://assets.example/f",
      }),
    ).not.toThrow();
  });

  it("throws DataError for options as JavaScript or JSON can deliver them", () => {
    expect(() => create(json("null"))).toThrow("The options must be an object, found null.");
    expect(() => create(json('"options"'))).toThrow('The options must be an object, found "options".');
    expect(() => create({ ...valid, extra: 1 })).toThrow(/^The options has the properties .* found "extra"\.$/u);
    expect(() => create({ ...valid, messages: json("null") })).toThrow(
      "The option messages is invalid: expected an object, found null.",
    );
    expect(() => create({ ...valid, messages: { ...EN_MESSAGES, toolOpenFile: json("1") } })).toThrow(
      "The option messages is invalid at toolOpenFile: expected a string, found 1.",
    );
    expect(() => create({ ...valid, assets: json('"assets"') })).toThrow(
      'The option assets must be a function, found "assets".',
    );
    expect(() => create({ ...valid, base: json("1") })).toThrow("The option base must be a string, found 1.");
    expect(() => create({ ...valid, origins: json('"https://media.example"') })).toThrow(
      'The option origins must be an array, found "https://media.example".',
    );
    expect(() => create({ ...valid, interactions: json("{}") })).toThrow(
      "The option interactions must be a Map from kind to function, found an object.",
    );
    expect(() => create({ ...valid, interactions: new Map([["choice-interaction", json("1")]]) })).toThrow(
      'The renderer of the interaction "choice-interaction" must be a function, found 1.',
    );
    expect(() => create({ ...valid, view: json('"admin"') })).toThrow(
      'The option view must be "author", "candidate", "proctor", "scorer", "testConstructor" or "tutor", found "admin".',
    );
    expect(() => create({ ...valid, withholdMedia: json('"yes"') })).toThrow(
      'The option withholdMedia must be true or false, found "yes".',
    );
    expect(() => create({ ...valid, mediaScale: json('"2"') })).toThrow(
      'The option mediaScale must be a positive number, found "2".',
    );
    expect(() => create({ ...valid, mediaScale: 0 })).toThrow(
      "The option mediaScale must be a positive number, found 0.",
    );
    expect(() => create({ ...valid, variables: json("{}") })).toThrow(
      "The outcomes of the option variables must be a Map, found undefined.",
    );
    expect(() => create({ ...valid, fileUrl: json("1") })).toThrow("The option fileUrl must be a function, found 1.");
  });

  it("throws DataError for a null option that has a default, as it is no way to leave one out", () => {
    for (const name of ["base", "origins", "interactions", "view", "withholdMedia", "mediaScale"]) {
      expect(() => create({ ...valid, [name]: json("null") }), name).toThrow(DataError);
    }
  });
});

describe("resolveUrl", () => {
  const load = (reference: string): string | undefined => resolveUrl(reference, policy, "load");
  const navigate = (reference: string): string | undefined => resolveUrl(reference, policy, "navigate");

  it("resolves a path against the document of the content, and gives it to assets as a path in the package", () => {
    expect(load("images/a.png")).toBe(`${ASSETS}items/q1/images/a.png`);
    expect(load("./a.png")).toBe(`${ASSETS}items/q1/a.png`);
    expect(load("../shared/b.png")).toBe(`${ASSETS}items/shared/b.png`);
    expect(resolveUrl("a.png", { ...policy, base: "" }, "load")).toBe(`${ASSETS}a.png`);
  });

  it("refuses a path that leaves the package, starts at the root of the host, or is empty", () => {
    expect(load("../../../escape.png")).toBeUndefined();
    expect(load("/etc/passwd")).toBeUndefined();
    expect(load("")).toBeUndefined();
    expect(load("   ")).toBeUndefined();
    expect(navigate("..\\..\\x")).toBeUndefined();
  });

  it("keeps an http or https URL of an allowed origin and refuses any other origin", () => {
    expect(navigate("https://media.example/x.png")).toBe("https://media.example/x.png");
    expect(navigate("HTTPS://MEDIA.EXAMPLE/x.png")).toBe("https://media.example/x.png");
    expect(navigate("https://evil.example/x.png")).toBeUndefined();
    expect(navigate("http://media.example/x.png")).toBeUndefined();
    expect(navigate("https://media.example.evil.example/x.png")).toBeUndefined();
    expect(navigate("https://media.example@evil.example/x.png")).toBeUndefined();
    expect(navigate("https:evil.example/x.png")).toBeUndefined();
  });

  it("resolves a URL without scheme but with a host to https, and refuses it unless the origin is allowed", () => {
    expect(navigate("//media.example/x.png")).toBe("https://media.example/x.png");
    expect(navigate("//evil.example/x.png")).toBeUndefined();
    expect(navigate("\\\\evil.example\\x.png")).toBeUndefined();
  });

  it("refuses javascript:, vbscript:, file:, ftp: and blob: URLs, whatever the spelling", () => {
    for (const reference of [
      "javascript:alert(1)",
      "  javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "\u0001javascript:alert(1)",
      "vbscript:x",
      "file:///etc/passwd",
      "ftp://media.example/x",
      "blob:https://media.example/9b2e",
    ]) {
      expect(load(reference), reference).toBeUndefined();
      expect(navigate(reference), reference).toBeUndefined();
    }
  });

  it("keeps the data: URL of a raster image for a resource, and refuses every other data: URL", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(load(png)).toBe(png);
    expect(load("DATA:image/PNG;base64,AAAA")).toBe("data:image/PNG;base64,AAAA");
    expect(navigate(png)).toBeUndefined();
    for (const reference of [
      "data:image/svg+xml,<svg onload=alert(1)/>",
      "data:text/html,<script>alert(1)</script>",
      "data:application/javascript,alert(1)",
      "data:,hello",
    ]) {
      expect(load(reference), reference).toBeUndefined();
    }
  });

  it("keeps a fragment for a link and refuses it for a resource", () => {
    expect(navigate("#note-1")).toBe("#note-1");
    expect(load("#note-1")).toBeUndefined();
  });
});

describe("resolveSrcset", () => {
  const resolve = (value: string): string | undefined => resolveSrcset(value, policy);

  it("resolves each candidate and keeps its descriptor, as HTML Standard 4.8.4.3.1 reads the list", () => {
    expect(resolve("a.png 1x, b.png 2x")).toBe(`${ASSETS}items/q1/a.png 1x, ${ASSETS}items/q1/b.png 2x`);
    expect(resolve("a.png, b.png 480w")).toBe(`${ASSETS}items/q1/a.png, ${ASSETS}items/q1/b.png 480w`);
    expect(resolve("a.png 1x,b.png 2x")).toBe(`${ASSETS}items/q1/a.png 1x, ${ASSETS}items/q1/b.png 2x`);
    expect(resolve("  a.png  1.5x ")).toBe(`${ASSETS}items/q1/a.png 1.5x`);
    expect(resolve("a.png .5x")).toBe(`${ASSETS}items/q1/a.png .5x`);
  });

  it("reads a comma inside a URL as part of it", () => {
    expect(resolve("data:image/png;base64,AAAA 1x, b.png 2x")).toBe(
      `data:image/png;base64,AAAA 1x, ${ASSETS}items/q1/b.png 2x`,
    );
  });

  it("leaves out a candidate with a refused URL or a descriptor that is not a width or a density", () => {
    expect(resolve("https://evil.example/e.png 1x, a.png 2x")).toBe(`${ASSETS}items/q1/a.png 2x`);
    expect(resolve("javascript:alert(1) 1x, a.png 2x")).toBe(`${ASSETS}items/q1/a.png 2x`);
    expect(resolve("a.png 5q, b.png 2x")).toBe(`${ASSETS}items/q1/b.png 2x`);
    expect(resolve("a.png 1x 2x, b.png")).toBe(`${ASSETS}items/q1/b.png`);
  });

  it("gives nothing when no candidate remains", () => {
    expect(resolve("")).toBeUndefined();
    expect(resolve(" , , ")).toBeUndefined();
    expect(resolve("https://evil.example/e.png 1x")).toBeUndefined();
  });
});

describe("readOrigins", () => {
  it("writes each origin as the URL parser does, without path or case", () => {
    expect([...readOrigins(["https://Media.example/path?q=1", "http://localhost:8080"])]).toEqual([
      "https://media.example",
      "http://localhost:8080",
    ]);
  });

  it("throws DataError for an origin that is not an http or https URL, and for a list that is not an array", () => {
    expect(() => readOrigins(["media.example"])).toThrow(DataError);
    expect(() => readOrigins(["ftp://media.example"])).toThrow(DataError);
    expect(() => readOrigins(["javascript:alert(1)"])).toThrow(
      'An origin of the option origins must be an absolute http or https URL, found "javascript:alert(1)".',
    );
    expect(() => readOrigins(json("[1]"))).toThrow("An origin of the option origins must be a string, found 1.");
    expect(() => readOrigins(json('"https://media.example"'))).toThrow(
      'The option origins must be an array, found "https://media.example".',
    );
  });
});

describe("properties", () => {
  it("returns a path of the package, an allowed origin or a raster image, never anything else", () => {
    fc.assert(
      fc.property(
        fc
          .oneof(fc.string(), fc.constantFrom("javascript:", "data:", "https://", "//", "..", "/", "\\", "#", "blob:"))
          .chain((head) => fc.string().map((tail) => `${head}${tail}`)),
        fc.constantFrom<"load" | "navigate">("load", "navigate"),
        (reference, use) => {
          const resolved = resolveUrl(reference, policy, use);
          if (resolved === undefined) return true;
          return (
            resolved.startsWith(ASSETS) ||
            resolved.startsWith("https://media.example/") ||
            (use === "load" && isRasterDataUrl(resolved)) ||
            (use === "navigate" && resolved.startsWith("#"))
          );
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("keeps in a srcset only candidates whose URL the policy allows, with a width or a density", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom(
              "a.png",
              "../b.png",
              "https://media.example/c.png",
              "https://evil.example/d.png",
              "javascript:x",
            ),
            fc.constantFrom("", " 1x", " 2.5x", " 480w", " 5q", " 1x 2x"),
          ),
          { maxLength: 5 },
        ),
        (candidates) => {
          const resolved = resolveSrcset(
            candidates.map(([url, descriptor]) => `${url}${descriptor}`).join(", "),
            policy,
          );
          const kept = resolved === undefined ? [] : resolved.split(", ");
          return kept.every(
            (candidate) =>
              /^(?:https:\/\/[^ ]+)(?: (?:\d+w|\d*\.?\d+x))?$/u.test(candidate) && !candidate.includes("evil"),
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});
