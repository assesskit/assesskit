import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assetResolver, BROWSER_CLOCK, UNSIGNED_URL } from "../src/client/index.js";

describe("assetResolver", () => {
  const assets = {
    "items/q1/": "https://assets.example/g/one/",
    "items/q1/media/": "https://assets.example/g/two/",
    "modules/": "https://assets.example/g/three/",
  };

  it("joins the base of the longest prefix that holds the path with the whole path", () => {
    const resolve = assetResolver(assets);
    expect(resolve("items/q1/images/map.png")).toBe("https://assets.example/g/one/items/q1/images/map.png");
    expect(resolve("items/q1/media/clip.mp3")).toBe("https://assets.example/g/two/items/q1/media/clip.mp3");
    expect(resolve("modules/pci/main.js")).toBe("https://assets.example/g/three/modules/pci/main.js");
  });

  it("gives a path that no prefix holds a URL that loads nothing", () => {
    const resolve = assetResolver(assets);
    expect(resolve("items/q2/image.png")).toBe(UNSIGNED_URL);
    expect(resolve("items/q1")).toBe(UNSIGNED_URL);
    expect(assetResolver({})("items/q1/a.png")).toBe(UNSIGNED_URL);
  });

  it("lets the empty prefix hold every path", () => {
    const resolve = assetResolver({ "": "https://assets.example/g/root/", "a/": "https://assets.example/g/a/" });
    expect(resolve("b/c.png")).toBe("https://assets.example/g/root/b/c.png");
    expect(resolve("a/c.png")).toBe("https://assets.example/g/a/a/c.png");
  });

  it("keeps a path that looks like a prototype property as data", () => {
    const resolve = assetResolver(JSON.parse('{"__proto__/":"https://assets.example/g/p/"}'));
    expect(resolve("__proto__/x.png")).toBe("https://assets.example/g/p/__proto__/x.png");
    expect(resolve("constructor/x.png")).toBe(UNSIGNED_URL);
  });
});

describe("BROWSER_CLOCK", () => {
  it("gives the time of the device in whole epoch milliseconds", () => {
    const before = Date.now();
    const now = BROWSER_CLOCK.now();
    expect(Number.isInteger(now)).toBe(true);
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe("properties", () => {
  it("gives each path the base of its longest prefix", () => {
    const directory = fc.stringMatching(/^([a-z]{1,3}\/){0,3}$/u);
    fc.assert(
      fc.property(
        fc.uniqueArray(directory, { minLength: 1, maxLength: 5 }),
        fc.stringMatching(/^[a-z/]{1,12}$/u),
        (prefixes, path) => {
          const assets = Object.fromEntries(
            prefixes.map((prefix, index) => [prefix, `https://assets.example/g/${index}/`]),
          );
          const holding = prefixes.filter((prefix) => path.startsWith(prefix));
          const longest = holding.reduce((a, b) => (b.length > a.length ? b : a), "");
          const url = assetResolver(assets)(path);
          if (holding.length === 0) expect(url).toBe(UNSIGNED_URL);
          else expect(url).toBe(`${assets[longest]}${path}`);
        },
      ),
    );
  });
});
