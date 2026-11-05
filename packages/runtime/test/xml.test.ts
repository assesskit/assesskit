// cspell:ignore waytoolongsubtag
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runGuideSamples } from "../../../scripts/guide-samples.js";
import { DataError, type Issue, ReadError, SecurityError } from "../src/errors.js";
import {
  buildElement,
  collectText,
  DEFAULT_XML_LIMITS,
  findAttribute,
  listChildElements,
  parseXml,
  resolveIncludes,
  serializeXml,
  XINCLUDE_NAMESPACE,
  XML_NAMESPACE,
  type XmlAttribute,
  type XmlElement,
  type XmlNode,
} from "../src/xml/index.js";
import {
  createReadError,
  createTermConverter,
  ElementReader,
  isXmlLanguage,
  locateElement,
  XMLNS_NAMESPACE,
  XSI_NAMESPACE,
} from "../src/xml/internal.js";
import { mutateBytes, mutateText, mutations } from "./arbitraries/xml.js";
import { expectOutcome, FUZZ } from "./fuzz.js";

const XSI = "http://www.w3.org/2001/XMLSchema-instance";
const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';

function element(
  name: string,
  children: readonly XmlNode[] = [],
  attributes: readonly XmlAttribute[] = [],
  namespace = "",
  prefix?: string,
): XmlElement {
  return { kind: "element", namespace, name, ...(prefix === undefined ? {} : { prefix }), attributes, children };
}

function text(value: string): XmlNode {
  return { kind: "text", value };
}

function attribute(name: string, value: string, namespace = "", prefix?: string): XmlAttribute {
  return { namespace, name, ...(prefix === undefined ? {} : { prefix }), value };
}

/** Returns the error a function throws, so that a test can look at it. */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("The function did not throw.");
}

/** Returns the error a function throws, after checking that it is of a class. */
function thrownAs<T extends Error>(type: new (...args: never[]) => T, run: () => unknown): T {
  const error = thrown(run);
  if (!(error instanceof type)) throw new Error(`Expected a ${type.name}, found ${String(error)}.`);
  return error;
}

/** Drops the positions that `parseXml` adds, so that a parsed tree can be compared with a built one. */
function withoutPositions(node: XmlElement): XmlElement;
function withoutPositions(node: XmlNode): XmlNode;
function withoutPositions(node: XmlNode): XmlNode {
  if (node.kind !== "element") return node;
  const { line: _line, column: _column, ...rest } = node;
  return { ...rest, children: node.children.map(withoutPositions) };
}

function parsed(xml: string): XmlElement {
  return withoutPositions(parseXml(xml));
}

function childElement(parent: XmlElement, index: number): XmlElement {
  const child = parent.children[index];
  if (child?.kind !== "element") throw new Error(`Child ${index} of ${parent.name} is not an element.`);
  return child;
}

function issueOf(error: unknown): Issue {
  if (!(error instanceof ReadError)) throw new Error(`Expected a ReadError, found ${String(error)}.`);
  const [issue] = error.issues;
  if (issue === undefined) throw new Error("The ReadError has no issue.");
  return issue;
}

describe("building elements", () => {
  it("builds an element in a namespace and leaves out the attributes that are undefined", () => {
    const built = buildElement("urn:a", "item", {
      attributes: { id: "x", title: undefined, "xml:lang": "en", "xsi:nil": "true" },
      children: ["text", "", element("b")],
    });
    expect(built).toEqual({
      kind: "element",
      namespace: "urn:a",
      name: "item",
      attributes: [
        { namespace: "", name: "id", value: "x" },
        { namespace: XML_NAMESPACE, prefix: "xml", name: "lang", value: "en" },
        { namespace: XSI_NAMESPACE, prefix: "xsi", name: "nil", value: "true" },
      ],
      children: [text("text"), element("b")],
    });
    expect(serializeXml(built)).toBe(
      `${DECLARATION}<item id="x" xml:lang="en" xsi:nil="true" xmlns="urn:a" xmlns:xsi="${XSI_NAMESPACE}">text<b xmlns=""/></item>`,
    );
  });

  it("builds an element with no attributes and no children by default", () => {
    expect(buildElement("", "a")).toEqual({ kind: "element", namespace: "", name: "a", attributes: [], children: [] });
  });

  it("rejects arguments of other types", () => {
    expect(() => buildElement(JSON.parse("5"), "a")).toThrow("The namespace of an element must be a string, found 5.");
    expect(() => buildElement("", JSON.parse("null"))).toThrow("The name of an element must be a string, found null.");
    expect(() => buildElement("", "a", JSON.parse("null"))).toThrow("The options must be an object, found null.");
    expect(() => buildElement("", "a", JSON.parse('{"bogus":1}'))).toThrow(
      'The options has the properties "attributes" and "children", found "bogus".',
    );
    expect(() => buildElement("", "a", { attributes: JSON.parse("null") })).toThrow(
      "The attributes of an element must be an object, found null.",
    );
    expect(() => buildElement("", "a", { children: JSON.parse('{"0":"x"}') })).toThrow(
      "The children of an element must be an array, found an object.",
    );
  });
});

describe("mapping an element to a model", () => {
  const Ns = "urn:demo";
  const rules = { module: "demo", namespaces: [Ns] };
  const open = (xml: string): ElementReader => ElementReader.open(xml, rules, "The demo");
  const failure = (run: () => unknown): ReadError => thrownAs(ReadError, run);

  describe("open", () => {
    it("takes text, bytes and an element, and names the document in the error for anything else", () => {
      const xml = `<a xmlns="${Ns}"/>`;
      expect(open(xml).name).toBe("a");
      expect(ElementReader.open(new TextEncoder().encode(xml), rules, "The demo").name).toBe("a");
      expect(ElementReader.open(parseXml(xml), rules, "The demo").name).toBe("a");
      expect(() => ElementReader.open(JSON.parse("null"), rules, "The demo")).toThrow(
        "The demo to read must be a string, a Uint8Array or an XmlElement, found null.",
      );
      expect(() => ElementReader.open(JSON.parse('{"kind":"text","value":"x"}'), rules, "The demo")).toThrow(DataError);
    });

    it("lets parseXml report a document that is not well-formed", () => {
      expect(() => open("<a>")).toThrow(ReadError);
    });

    it("rejects rules that are not rules", () => {
      const element = parseXml(`<a xmlns="${Ns}"/>`);
      expect(() => new ElementReader(element, JSON.parse("null"))).toThrow(
        "The rules of a reader must be an object, found null.",
      );
      expect(() => new ElementReader(element, JSON.parse('{"module":5,"namespaces":[]}'))).toThrow(
        "The module of the rules of a reader must be a string, found 5.",
      );
      expect(() => new ElementReader(element, JSON.parse('{"module":"m","namespaces":"urn:a"}'))).toThrow(
        'The namespaces of the rules of a reader must be an array, found "urn:a".',
      );
    });
  });

  describe("attributes", () => {
    it("reads attributes in no namespace, and converts them with a function that throws DataError", () => {
      const reader = open(`<a xmlns="${Ns}" n="12" word="x" xml:lang="en"/>`);
      expect(reader.attribute("word")).toBe("x");
      expect(reader.attribute("n", Number)).toBe(12);
      expect(reader.attribute("missing")).toBeUndefined();
      expect(reader.attribute("missing", Number)).toBeUndefined();
      expect(reader.required("word")).toBe("x");
      expect(reader.language()).toBe("en");
      expect(reader.requiredLanguage()).toBe("en");
      expect(() => reader.done()).not.toThrow();
    });

    it("reports a missing attribute and one that cannot be converted, with the position and the element path", () => {
      const reader = open(`<a xmlns="${Ns}">\n  <b n="x"/></a>`);
      const child = reader.require("b");
      const missing = issueOf(failure(() => child.required("id")));
      expect(missing).toEqual({
        severity: "error",
        rule: "assesskit/demo/missing-attribute",
        message: "The element b needs the attribute id.",
        location: { line: 2, column: 3, element: "a/b" },
      });
      const invalid = failure(() =>
        child.attribute("n", (value) => {
          throw new DataError(`The text ${JSON.stringify(value)} is not a number.`);
        }),
      );
      expect(invalid.message).toBe(
        'The attribute n of the element b is invalid. The text "x" is not a number. (line 2, column 3)',
      );
      expect(issueOf(invalid).rule).toBe("assesskit/demo/invalid-attribute");
    });

    it("does not catch an error that is not a DataError", () => {
      const reader = open(`<a xmlns="${Ns}" n="x"/>`);
      expect(() =>
        reader.attribute("n", () => {
          throw new RangeError("boom");
        }),
      ).toThrow(RangeError);
    });

    it("reads an attribute that is one of some terms, and names the terms when it is another", () => {
      const reader = open(`<a xmlns="${Ns}" kind="b" bad="z"/>`);
      expect(reader.term("kind", ["a", "b"])).toBe("b");
      expect(reader.requiredTerm("kind", ["a", "b"])).toBe("b");
      expect(reader.term("none", ["a", "b"])).toBeUndefined();
      expect(() => reader.requiredTerm("none", ["a", "b"])).toThrow("The element a needs the attribute none.");
      expect(() => reader.term("bad", ["a", "b"])).toThrow(
        'The attribute bad of the element a is invalid. The attribute bad must be "a" or "b", found "z".',
      );
    });

    it("rejects an xml:lang that is not a language tag, and a missing one where it is required", () => {
      expect(() => open(`<a xmlns="${Ns}" xml:lang="en_US"/>`).language()).toThrow(
        'The attribute xml:lang of the element a is invalid. The text "en_US" is not a language tag such as en or pt-BR.',
      );
      expect(() => open(`<a xmlns="${Ns}"/>`).requiredLanguage()).toThrow(
        "The element a needs the attribute xml:lang.",
      );
      expect(open(`<a xmlns="${Ns}" xml:lang=""/>`).language()).toBe("");
    });
  });

  describe("children", () => {
    const xml = `<a xmlns="${Ns}" xmlns:x="urn:other"><b/><c/><c/><x:ext/><d/></a>`;

    it("takes the children in order: a named one, a run of them, and the extensions", () => {
      const reader = open(xml);
      expect(reader.take("c")).toBeUndefined();
      expect(reader.take("b")?.name).toBe("b");
      expect(reader.takeAny(["z", "d"])).toBeUndefined();
      expect(reader.takeAll("c").map((child) => child.name)).toEqual(["c", "c"]);
      expect(reader.takeAll("c")).toEqual([]);
      expect(reader.takeForeign().map((child) => child.name)).toEqual(["ext"]);
      expect(reader.require("d").name).toBe("d");
      expect(reader.next()).toBeUndefined();
      expect(() => reader.done()).not.toThrow();
    });

    it("reads every child in order with next, and tells an extension by foreign", () => {
      const reader = open(xml);
      const seen: [string, boolean, string][] = [];
      for (let child = reader.next(); child !== undefined; child = reader.next()) {
        seen.push([child.name, child.foreign, child.qualifiedName]);
      }
      expect(seen).toEqual([
        ["b", false, "b"],
        ["c", false, "c"],
        ["c", false, "c"],
        ["ext", true, "{urn:other}ext"],
        ["d", false, "d"],
      ]);
    });

    it("requires a child by name and says what it found instead", () => {
      const reader = open(xml);
      expect(() => reader.require("c")).toThrow("The element a needs the element c, found the element b.");
      const empty = open(`<a xmlns="${Ns}"/>`);
      expect(issueOf(failure(() => empty.require("c"))).rule).toBe("assesskit/demo/missing-element");
      expect(() => empty.require("c")).toThrow("found no more elements.");
    });

    it("treats elements of the other namespaces as extensions, not as model elements", () => {
      const reader = ElementReader.open(`<a xmlns="${Ns}"><b xmlns="urn:other"/></a>`, rules, "The demo");
      expect(reader.take("b")).toBeUndefined();
      expect(reader.takeForeign()).toHaveLength(1);
    });

    it("accepts several namespaces for the model", () => {
      const both = { ...rules, namespaces: [Ns, "urn:old"] };
      const reader = ElementReader.open(`<a xmlns="${Ns}"><b xmlns="urn:old"/></a>`, both, "The demo");
      expect(reader.require("b").foreign).toBe(false);
    });
  });

  describe("text", () => {
    it("joins text and CDATA sections without comments, and converts the result", () => {
      const reader = open(`<a xmlns="${Ns}">1<!-- c --><![CDATA[2]]>3</a>`);
      expect(reader.text()).toBe("123");
      expect(reader.text(Number)).toBe(123);
      expect(() => reader.done()).not.toThrow();
    });

    it("reports text that cannot be converted, and an element where only text may be", () => {
      expect(() =>
        open(`<a xmlns="${Ns}">x</a>`).text(() => {
          throw new DataError("It is not a number.");
        }),
      ).toThrow("The text of the element a is invalid. It is not a number.");
      expect(() => open(`<a xmlns="${Ns}"><b/></a>`).text()).toThrow(
        "The element a has the element b, but it contains text only.",
      );
    });
  });

  describe("done", () => {
    it("rejects an attribute that was not read, but not a namespace declaration or an xsi attribute", () => {
      const reader = open(`<a xmlns="${Ns}" xmlns:xsi="${XSI_NAMESPACE}" xsi:schemaLocation="u v" id="1" extra="2"/>`);
      reader.required("id");
      expect(issueOf(failure(() => reader.done()))).toMatchObject({
        rule: "assesskit/demo/unexpected-attribute",
        message: "The element a has the attribute extra, which the schema does not define for it.",
      });
      expect(() => open(`<a xmlns="${Ns}" xmlns:p="urn:p" p:x="1"/>`).done()).toThrow(
        "The element a has the attribute p:x, which the schema does not define for it.",
      );
    });

    it("rejects a child that was not taken and text where only elements may be", () => {
      expect(() => open(`<a xmlns="${Ns}"><b/></a>`).done()).toThrow(
        "The element b is not allowed in a at this place. (line 1, column 21)",
      );
      expect(() => open(`<a xmlns="${Ns}">text<b/></a>`).done()).toThrow(
        "The element a has text, but it contains elements only.",
      );
      expect(() => open(`<a xmlns="${Ns}">  <b/>  </a>`).require("b")).not.toThrow();
    });

    it("rejects an element that is not an element of the tree", () => {
      expect(() => new ElementReader(JSON.parse('{"kind":"text","value":"x"}'), rules)).toThrow(
        "The element to read must be an element of the tree that parseXml returns.",
      );
    });
  });

  describe("path, base, leaf and createTermConverter", () => {
    it("names the document in the issues when open gets a path, and passes the limits to parseXml", () => {
      const reader = ElementReader.open(`<a xmlns="${Ns}"><b/></a>`, rules, "The demo", { path: "d/a.xml" });
      const error = failure(() => reader.done());
      expect(error.issues[0]?.location).toEqual({ path: "d/a.xml", line: 1, column: 21, element: "a/b" });
      expect(() => ElementReader.open(`<a xmlns="${Ns}"/>`, rules, "The demo", { limits: { maxNodes: 0 } })).toThrow(
        DataError,
      );
      expect(() =>
        ElementReader.open(`<a xmlns="${Ns}"><b/></a>`, rules, "The demo", { limits: { maxNodes: 1 } }),
      ).toThrow(SecurityError);
      expect(() => ElementReader.open(`<a xmlns="${Ns}"/>`, rules, "The demo", JSON.parse("null"))).toThrow(DataError);
    });

    it("names the document in the issues when the rules have a path, and rejects a path that is not a string", () => {
      const element = parseXml(`<a xmlns="${Ns}"><b/></a>`);
      const reader = new ElementReader(element, { ...rules, path: "r.xml" });
      expect(failure(() => reader.done()).issues[0]?.location?.path).toBe("r.xml");
      expect(
        () => new ElementReader(element, JSON.parse('{"module":"m","source":"s","namespaces":[],"path":5}')),
      ).toThrow("The path of the rules of a reader must be a string, found 5.");
    });

    it("reads xml:base, which is the value or undefined, and counts it as read", () => {
      const reader = open(`<a xmlns="${Ns}" xml:base="items/"/>`);
      expect(reader.base()).toBe("items/");
      expect(() => reader.done()).not.toThrow();
      expect(open(`<a xmlns="${Ns}"/>`).base()).toBeUndefined();
      expect(failure(() => open(`<a xmlns="${Ns}" xml:base="items/"/>`).done()).issues[0]?.rule).toBe(
        "assesskit/demo/unexpected-attribute",
      );
    });

    it("reads the text of an element and finishes it, so that an attribute that is left is an error", () => {
      const integer = (text: string): number => {
        if (!/^\d+$/.test(text)) throw new DataError("The text must be digits.");
        return Number(text);
      };
      expect(open(`<a xmlns="${Ns}">12</a>`).leaf(integer)).toBe(12);
      expect(failure(() => open(`<a xmlns="${Ns}" x="1">12</a>`).leaf(integer)).issues[0]?.rule).toBe(
        "assesskit/demo/unexpected-attribute",
      );
      expect(failure(() => open(`<a xmlns="${Ns}">x</a>`).leaf(integer)).issues[0]?.rule).toBe(
        "assesskit/demo/invalid-text",
      );
    });

    it("converts the text of an element or an attribute to one of some terms", () => {
      const terms = createTermConverter(["red", "green"]);
      expect(open(`<a xmlns="${Ns}">red</a>`).text(terms)).toBe("red");
      expect(open(`<a xmlns="${Ns}" c="green"/>`).attribute("c", terms)).toBe("green");
      expect(() => terms("blue")).toThrow('The text must be "red" or "green", found "blue".');
      expect(() => createTermConverter(["a", "b"], { label: "The color" })("c")).toThrow(
        'The color must be "a" or "b", found "c".',
      );
      expect(() => createTermConverter(["a"], JSON.parse("null"))).toThrow(
        "The options object is invalid: expected an object, found null",
      );
      expect(() => createTermConverter(["a"], JSON.parse('{"bogus":1}'))).toThrow('unexpected property "bogus"');
      expect(failure(() => open(`<a xmlns="${Ns}">blue</a>`).text(terms)).issues[0]?.rule).toBe(
        "assesskit/demo/invalid-text",
      );
    });
  });
});

describe("XInclude", () => {
  const xi = (name: string, children: readonly XmlNode[] = [], attributes: readonly XmlAttribute[] = []): XmlElement =>
    element(name, children, attributes, XINCLUDE_NAMESPACE, "xi");
  const include = (href: string, children: readonly XmlNode[] = [], extra: readonly XmlAttribute[] = []): XmlElement =>
    xi("include", children, [attribute("href", href), ...extra]);
  const resolver =
    (documents: Readonly<Record<string, string>>, log: [string, string][] = []) =>
    (href: string, base: string) => {
      log.push([href, base]);
      const source = documents[href];
      if (source === undefined) throw new ReadError(`${href} is not in the package.`, []);
      return parseXml(source, { path: href });
    };
  const strip = (node: XmlNode): XmlNode => withoutPositions(node);

  it("replaces an include with the root element of the fragment it names", () => {
    const item = parseXml(
      '<item xmlns:xi="http://www.w3.org/2001/XInclude"><body><p>before</p><xi:include href="choice.xml"/><p>after</p></body></item>',
    );
    const result = resolveIncludes(
      item,
      "items/a.xml",
      resolver({ "choice.xml": '<choice id="c"><text>Pick</text></choice>' }),
    );
    expect(strip(result)).toEqual(
      strip(
        parseXml(
          '<item xmlns:xi="http://www.w3.org/2001/XInclude"><body><p>before</p><choice id="c"><text>Pick</text></choice><p>after</p></body></item>',
        ),
      ),
    );
  });

  it("expands the includes of an included fragment, resolving them against the fragment's own path", () => {
    const calls: [string, string][] = [];
    const root = parseXml(
      '<test xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="sections/s1.xml"/></test>',
    );
    const result = resolveIncludes(
      root,
      "tests/t.xml",
      resolver(
        {
          "sections/s1.xml":
            '<section xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="../items/i1.xml"/></section>',
          "../items/i1.xml": "<item/>",
        },
        calls,
      ),
    );
    expect(strip(result)).toEqual(
      strip(
        parseXml(
          '<test xmlns:xi="http://www.w3.org/2001/XInclude"><section xmlns:xi="http://www.w3.org/2001/XInclude"><item/></section></test>',
        ),
      ),
    );
    expect(calls).toEqual([
      ["sections/s1.xml", "tests/t.xml"],
      ["../items/i1.xml", "tests/sections/s1.xml"],
    ]);
  });

  it("gives a tree without includes back unchanged in content", () => {
    const root = parseXml("<a><b>t</b><!--c--></a>");
    expect(resolveIncludes(root, "a.xml", () => root)).toEqual(root);
  });

  it("ignores encoding, accept and accept-language, which concern text and HTTP", () => {
    const root = element("a", [
      include(
        "f.xml",
        [],
        [attribute("encoding", "UTF-8"), attribute("accept", "text/xml"), attribute("accept-language", "en")],
      ),
    ]);
    expect(resolveIncludes(root, "a.xml", resolver({ "f.xml": "<f/>" })).children).toEqual([parseXml("<f/>")]);
  });

  it("uses the xi:fallback of an include whose resource cannot be read", () => {
    const root = element("a", [
      include("missing.xml", [xi("fallback", [text("default "), element("p")])]),
      element("z"),
    ]);
    expect(resolveIncludes(root, "a.xml", resolver({})).children).toEqual([
      text("default "),
      element("p"),
      element("z"),
    ]);
  });

  it("expands the includes inside a fallback", () => {
    const root = element("a", [include("missing.xml", [xi("fallback", [include("other.xml")])])]);
    expect(resolveIncludes(root, "a.xml", resolver({ "other.xml": "<o/>" })).children).toEqual([parseXml("<o/>")]);
  });

  it("does not use the fallback when the resource is read, and drops it", () => {
    const root = element("a", [include("f.xml", [xi("fallback", [text("unused")])])]);
    expect(resolveIncludes(root, "a.xml", resolver({ "f.xml": "<f/>" })).children).toEqual([parseXml("<f/>")]);
  });

  it("never replaces a SecurityError of the resolver with the fallback", () => {
    const refuse = () => {
      throw new SecurityError("The href leaves the package.", "pathEscape", 0);
    };
    const root = element("a", [include("../../etc/passwd", [xi("fallback")])]);
    expect(thrown(() => resolveIncludes(root, "a.xml", refuse))).toBeInstanceOf(SecurityError);
  });

  it("rejects an include whose resource cannot be read and that has no fallback", () => {
    const root = element("a", [include("missing.xml")]);
    const error = thrown(() => resolveIncludes(root, "a.xml", resolver({})));
    expect(error).toMatchObject({ cause: { message: "missing.xml is not in the package." } });
    const issue = issueOf(error);
    expect(issue).toMatchObject({ rule: "assesskit/xml/xinclude-resource" });
    expect(issue.message).toBe(
      'The document "missing.xml" of an xi:include cannot be read and the include has no xi:fallback: missing.xml is not in the package.',
    );
  });

  it("rejects an xpointer, which QTI forbids", () => {
    const root = element("a", [
      xi("include", [], [attribute("href", "f.xml"), attribute("xpointer", "element(/1/2)")]),
    ]);
    const issue = issueOf(thrown(() => resolveIncludes(root, "a.xml", resolver({ "f.xml": "<f/>" }))));
    expect(issue).toMatchObject({
      rule: "assesskit/xml/xinclude-attribute",
      location: { path: "a.xml" },
    });
    expect(issue.message).toBe("An xi:include must not have an xpointer attribute.");
  });

  it.each([
    [
      "parse=text",
      xi("include", [], [attribute("href", "f.xml"), attribute("parse", "text")]),
      'An xi:include must include parsed XML, found parse="text".',
    ],
    ["no href", xi("include"), "An xi:include must have a non-empty href attribute."],
    ["an empty href", include(""), "An xi:include must have a non-empty href attribute."],
    [
      "a fragment identifier",
      include("f.xml#part"),
      'The href "f.xml#part" of an xi:include must not have a fragment identifier.',
    ],
  ])("rejects an include with %s", (_name, bad, message) => {
    const issue = issueOf(thrown(() => resolveIncludes(element("a", [bad]), "a.xml", resolver({ "f.xml": "<f/>" }))));
    expect(issue).toMatchObject({ rule: "assesskit/xml/xinclude-attribute" });
    expect(issue.message).toBe(message);
  });

  it("rejects an include with two fallbacks or another element of the XInclude namespace", () => {
    for (const children of [[xi("fallback"), xi("fallback")], [xi("include")]]) {
      const issue = issueOf(
        thrown(() =>
          resolveIncludes(element("a", [include("f.xml", children)]), "a.xml", resolver({ "f.xml": "<f/>" })),
        ),
      );
      expect(issue).toMatchObject({ rule: "assesskit/xml/xinclude-structure" });
    }
  });

  it("rejects an xi:fallback outside an include", () => {
    const issue = issueOf(thrown(() => resolveIncludes(element("a", [xi("fallback")]), "a.xml", resolver({}))));
    expect(issue).toMatchObject({ rule: "assesskit/xml/xinclude-structure" });
  });

  it("rejects includes that form a loop, however long", () => {
    const documents = {
      "a.xml": '<a xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="b.xml"/></a>',
      "b.xml": '<b xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="a.xml"/></b>',
    };
    const issue = issueOf(thrown(() => resolveIncludes(parseXml(documents["a.xml"]), "a.xml", resolver(documents))));
    expect(issue).toMatchObject({ rule: "assesskit/xml/xinclude-cycle" });
    expect(issue.message).toBe('The xi:include of "a.xml" includes a document that is already being included.');
  });

  it("finds a loop through a different spelling of the same path", () => {
    const documents = {
      "d/a.xml": '<a xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="./x/../a.xml"/></a>',
    };
    const run = () =>
      resolveIncludes(parseXml(documents["d/a.xml"]), "d/a.xml", (href) => parseXml(documents["d/a.xml"] ?? href));
    expect(issueOf(thrown(run))).toMatchObject({ rule: "assesskit/xml/xinclude-cycle" });
  });

  it("allows includes to nest maxIncludeDepth deep and no deeper", () => {
    const chain = (href: string) =>
      parseXml(
        href === "f8.xml"
          ? "<end/>"
          : `<n xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="f${Number(href.slice(1, -4)) + 1}.xml"/></n>`,
      );
    const root = element("a", [include("f1.xml")]);
    expect(resolveIncludes(root, "a.xml", chain, { limits: { maxIncludeDepth: 8 } }).name).toBe("a");
    const error = thrown(() => resolveIncludes(root, "a.xml", chain, { limits: { maxIncludeDepth: 7 } }));
    expect(error).toMatchObject({ limit: "maxIncludeDepth", maximum: 7 });
  });

  it("counts the nodes of the result against maxNodes, so that includes cannot multiply a document", () => {
    const ten = (href: string) =>
      element(
        "n",
        Array.from({ length: 10 }, () => include(href === "l1.xml" ? "l2.xml" : "l3.xml")),
      );
    const resolve = (href: string) => (href === "l3.xml" ? element("leaf") : ten(href));
    const root = element(
      "a",
      Array.from({ length: 10 }, () => include("l1.xml")),
    );
    const error = thrown(() => resolveIncludes(root, "a.xml", resolve, { limits: { maxNodes: 500 } }));
    expect(error).toBeInstanceOf(SecurityError);
    expect(error).toMatchObject({ limit: "maxNodes", maximum: 500 });
  });

  it("counts the depth of the result against maxDepth", () => {
    const root = element("a", [element("b", [include("f.xml")])]);
    const resolve = () => element("f", [element("g")]);
    expect(resolveIncludes(root, "a.xml", resolve, { limits: { maxDepth: 4 } }).name).toBe("a");
    expect(thrown(() => resolveIncludes(root, "a.xml", resolve, { limits: { maxDepth: 3 } }))).toMatchObject({
      limit: "maxDepth",
      maximum: 3,
    });
  });

  it("lets an include be the root when it is replaced by exactly one element", () => {
    expect(resolveIncludes(include("f.xml"), "a.xml", resolver({ "f.xml": "<f/>" }))).toEqual(parseXml("<f/>"));
    const two = include("missing.xml", [xi("fallback", [element("x"), element("y")])]);
    expect(issueOf(thrown(() => resolveIncludes(two, "a.xml", resolver({}))))).toMatchObject({
      rule: "assesskit/xml/xinclude-structure",
    });
  });

  it("throws DataError for input of other types, as JavaScript or JSON pass it", () => {
    const root = element("a");
    const resolve = () => root;
    expect(() => resolveIncludes(JSON.parse("null"), "a.xml", resolve)).toThrow(
      "The root must be an element, found null.",
    );
    expect(() => resolveIncludes(root, JSON.parse("1"), resolve)).toThrow("The base must be a string, found 1.");
    expect(() => resolveIncludes(root, "a.xml", JSON.parse("{}"))).toThrow(
      "The resolver must be a function of an href and a base, found an object.",
    );
    expect(() => resolveIncludes(root, "a.xml", resolve, JSON.parse("null"))).toThrow(
      "The options object is invalid: expected an object, found null",
    );
    expect(() => resolveIncludes(root, "a.xml", resolve, JSON.parse('{"bogus":1}'))).toThrow(
      'unexpected property "bogus"',
    );
    expect(() => resolveIncludes(root, "a.xml", resolve, JSON.parse('{"limits": null}'))).toThrow(
      "The options object is invalid at limits: expected an object, found null.",
    );
    expect(() => resolveIncludes(root, "a.xml", resolve, JSON.parse('{"limits": {"maxIncludeDepth": 0}}'))).toThrow(
      "The options object is invalid at limits.maxIncludeDepth: expected a value of at least 1, found 0.",
    );
    expect(() => resolveIncludes(element("a", [include("f.xml")]), "a.xml", () => JSON.parse("null"))).toThrow(
      "The include resolver must return an element, found null.",
    );
    expect(() =>
      resolveIncludes(element("a", [include("f.xml")]), "a.xml", () => JSON.parse('{"kind":"text","value":"x"}')),
    ).toThrow(DataError);
  });
});

describe("language tags", () => {
  it("accepts language tags of letters and digits in subtags of up to eight, and the empty string", () => {
    for (const tag of ["en", "pt-BR", "es-419", "zh-Hant-TW", "ase", "x-private", ""])
      expect(isXmlLanguage(tag), tag).toBe(true);
  });

  it("rejects what is not a tag", () => {
    for (const tag of ["en_US", "-en", "en-", "en--US", "123", "waytoolongsubtag", " en"])
      expect(isXmlLanguage(tag), tag).toBe(false);
    expect(isXmlLanguage(JSON.parse("5"))).toBe(false);
  });
});

describe("default limits", () => {
  it("is about 300 times the largest example for size and nodes, 16 times for depth and 20 times for attributes", () => {
    // The largest 1EdTech example has 32 KiB, depth 16, 12 attributes on an element and 1,126 nodes.
    expect(DEFAULT_XML_LIMITS).toEqual({
      maxBytes: 10_485_760,
      maxDepth: 256,
      maxAttributes: 256,
      maxNodes: 300_000,
      maxIncludeDepth: 8,
    });
  });
});

describe("parsing", () => {
  it("reads names, namespaces, prefixes and attributes, and keeps the namespace declarations as attributes", () => {
    const xml = `<a xmlns="urn:a" xmlns:b="urn:b" xmlns:xsi="${XSI}" xsi:schemaLocation="urn:a a.xsd" b:x="1" y="2"><b:c/></a>`;
    expect(parsed(xml)).toEqual(
      element(
        "a",
        [element("c", [], [], "urn:b", "b")],
        [
          attribute("xmlns", "urn:a", XMLNS_NAMESPACE),
          attribute("b", "urn:b", XMLNS_NAMESPACE, "xmlns"),
          attribute("xsi", XSI, XMLNS_NAMESPACE, "xmlns"),
          attribute("schemaLocation", "urn:a a.xsd", XSI, "xsi"),
          attribute("x", "1", "urn:b", "b"),
          attribute("y", "2"),
        ],
        "urn:a",
      ),
    );
  });

  it("puts an unprefixed element in no namespace when the default namespace is undeclared", () => {
    expect(parsed('<a xmlns="urn:a"><b xmlns=""/></a>')).toEqual(
      element(
        "a",
        [element("b", [], [attribute("xmlns", "", XMLNS_NAMESPACE)])],
        [attribute("xmlns", "urn:a", XMLNS_NAMESPACE)],
        "urn:a",
      ),
    );
  });

  it("keeps text, CDATA sections, comments and processing instructions in order, with references replaced", () => {
    const root = parsed("<a>x &amp; &#65;&#x42;<![CDATA[<y>]]><!--c--><?pi some data?>z</a>");
    expect(root.children).toEqual([
      text("x & AB"),
      { kind: "cdata", value: "<y>" },
      { kind: "comment", value: "c" },
      { kind: "instruction", target: "pi", data: "some data" },
      text("z"),
    ]);
  });

  it("replaces the five predefined entities", () => {
    expect(parsed("<a>&lt;&gt;&amp;&apos;&quot;</a>").children).toEqual([text("<>&'\"")]);
  });

  it("normalizes line ends to a line feed, as XML 1.0 says", () => {
    expect(parsed("<a>1\r\n2\r3\n4</a>").children).toEqual([text("1\n2\n3\n4")]);
  });

  it("normalizes white space in attribute values to spaces, but keeps it when it is a character reference", () => {
    expect(parsed('<a x="1\n2\t3&#10;4"/>').attributes).toEqual([attribute("x", "1 2 3\n4")]);
  });

  it("leaves out the declaration and the comments and white space around the root", () => {
    expect(parsed('<?xml version="1.0"?>\n<!-- before --><a/>\n<!-- after -->\n')).toEqual(element("a"));
  });

  it("gives each element the line and column of its start tag, counting from 1", () => {
    const root = parseXml('<a>\n  <!-- c --><b\n    x="1">\n\n<c/></b></a>');
    const b = childElement(root, 2);
    const c = childElement(b, 1);
    expect([root.line, root.column]).toEqual([1, 1]);
    expect([b.line, b.column]).toEqual([2, 13]);
    expect([c.line, c.column]).toEqual([5, 1]);
  });

  it("counts a line end of \\r\\n, \\r or \\n as one, and gives a byte order mark no column", () => {
    const root = parseXml("\uFEFF<a>\r\n<b/>\r<c/>\n<d/></a>");
    const positions = root.children
      .filter((child): child is XmlElement => child.kind === "element")
      .map(({ name, line, column }) => [name, line, column]);
    expect(positions).toEqual([
      ["b", 2, 1],
      ["c", 3, 1],
      ["d", 4, 1],
    ]);
    expect([root.line, root.column]).toEqual([1, 1]);
  });

  it("counts columns in characters, not in UTF-16 units", () => {
    const root = parseXml("<a>😀<b/></a>");
    expect(childElement(root, 1).column).toBe(5);
  });

  it("reads an attribute named like a property of Object.prototype as data", () => {
    const root = parseXml('<a __proto__="1" constructor="2" toString="3"/>');
    expect(root.attributes.map(({ name, value }) => [name, value])).toEqual([
      ["__proto__", "1"],
      ["constructor", "2"],
      ["toString", "3"],
    ]);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  describe("encodings", () => {
    const body = "<a>é€</a>";
    const bytes = (value: string, encoding: "utf8" | "utf16le" | "latin1" = "utf8") =>
      new Uint8Array(Buffer.from(value, encoding));
    const swapped = (value: string) => new Uint8Array(Buffer.from(value, "utf16le").swap16());

    it("reads UTF-8 without a declaration", () => {
      expect(parsed(`${body}`)).toEqual(element("a", [text("é€")]));
      expect(withoutPositions(parseXml(bytes(body)))).toEqual(element("a", [text("é€")]));
    });

    it("reads UTF-8 with a byte order mark", () => {
      const root = parseXml(bytes(`﻿<?xml version="1.0" encoding="utf-8"?>${body}`));
      expect(root.children).toEqual([text("é€")]);
    });

    it("reads UTF-16 in both byte orders when a byte order mark says which", () => {
      const xml = `﻿<?xml version="1.0" encoding="UTF-16"?>${body}`;
      expect(parseXml(bytes(xml, "utf16le")).children).toEqual([text("é€")]);
      expect(parseXml(swapped(xml)).children).toEqual([text("é€")]);
    });

    it("reads the encoding that the declaration names when there is no byte order mark", () => {
      const xml = new Uint8Array(Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><a>\xE9</a>', "latin1"));
      expect(parseXml(xml).children).toEqual([text("é")]);
    });

    it("reads ISO-8859-1 byte for byte and windows-1252 as the Encoding Standard defines it", () => {
      const declared = (encoding: string) =>
        new Uint8Array(Buffer.from(`<?xml version="1.0" encoding="${encoding}"?><a>\xE9\x80</a>`, "latin1"));
      for (const label of ["ISO-8859-1", "iso-8859-1", "latin1", "ISO_8859-1", "ISO8859-1"]) {
        expect(parseXml(declared(label)).children).toEqual([text("é\u0080")]);
      }
      expect(parseXml(declared("windows-1252")).children).toEqual([text("é€")]);
    });

    it("reads a long ISO-8859-1 document", () => {
      const long = new Uint8Array(
        Buffer.from(`<?xml version="1.0" encoding="ISO-8859-1"?><a>${"\xE9".repeat(300_000)}</a>`, "latin1"),
      );
      expect(parseXml(long).children).toEqual([text("é".repeat(300_000))]);
    });

    it("takes a string as it is and ignores the encoding it declares", () => {
      expect(parseXml('<?xml version="1.0" encoding="ISO-8859-1"?><a>é€</a>').children).toEqual([text("é€")]);
      expect(parseXml(`﻿${body}`).children).toEqual([text("é€")]);
    });

    it.each([
      [
        "a UTF-8 byte order mark and another encoding",
        bytes('﻿<?xml version="1.0" encoding="ISO-8859-1"?><a/>'),
        /declares the encoding "ISO-8859-1"/,
      ],
      [
        "a UTF-16 byte order mark and UTF-8",
        bytes('﻿<?xml version="1.0" encoding="UTF-8"?><a/>', "utf16le"),
        /declares the encoding "UTF-8"/,
      ],
      [
        "an encoding the runtime does not know",
        bytes('<?xml version="1.0" encoding="no-such-encoding"?><a/>'),
        /does not support it/,
      ],
      [
        "UTF-16 without a byte order mark",
        bytes('<?xml version="1.0" encoding="UTF-16"?><a/>'),
        /needs a byte order mark/,
      ],
      [
        "bytes that are not UTF-8",
        new Uint8Array([0x3c, 0x61, 0x3e, 0xff, 0x3c, 0x2f, 0x61, 0x3e]),
        /is not valid utf-8/,
      ],
    ])("rejects %s", (_name, input, message) => {
      const issue = issueOf(thrown(() => parseXml(input, { path: "items/a.xml" })));
      expect(issue).toMatchObject({
        severity: "error",
        rule: "assesskit/xml/encoding",
        location: { path: "items/a.xml" },
      });
      expect(issue.message).toMatch(message);
    });

    it("carries the error of the decoder as the cause of bytes that are not in their encoding", () => {
      const bytes = new Uint8Array([0x3c, 0x61, 0x3e, 0xff, 0x3c, 0x2f, 0x61, 0x3e]);
      expect(thrown(() => parseXml(bytes))).toMatchObject({ cause: expect.any(TypeError) });
    });
  });

  describe("limits", () => {
    it("counts the bytes of UTF-8: a document of exactly maxBytes is read and one byte more is not", () => {
      const xml = "<a>é</a>";
      expect(parseXml(xml, { limits: { maxBytes: 9 } }).children).toEqual([text("é")]);
      expect(parseXml(new TextEncoder().encode(xml), { limits: { maxBytes: 9 } }).children).toEqual([text("é")]);
      for (const input of [xml, new TextEncoder().encode(xml)]) {
        const error = thrown(() => parseXml(input, { limits: { maxBytes: 8 } }));
        expect(error).toBeInstanceOf(SecurityError);
        expect(error).toMatchObject({ limit: "maxBytes", maximum: 8 });
      }
    });

    it("allows nesting up to maxDepth, counting the root as 1", () => {
      expect(parseXml("<a><b><c/></b></a>", { limits: { maxDepth: 3 } }).name).toBe("a");
      expect(thrown(() => parseXml("<a><b><c/></b></a>", { limits: { maxDepth: 2 } }))).toMatchObject({
        limit: "maxDepth",
        maximum: 2,
      });
    });

    it("allows maxAttributes on an element, namespace declarations included", () => {
      expect(parseXml('<a xmlns="urn:a" x="1"/>', { limits: { maxAttributes: 2 } }).attributes).toHaveLength(2);
      expect(thrown(() => parseXml('<a xmlns="urn:a" x="1"/>', { limits: { maxAttributes: 1 } }))).toMatchObject({
        limit: "maxAttributes",
        maximum: 1,
      });
    });

    it("allows maxNodes elements, text, CDATA sections, comments and processing instructions", () => {
      const xml = "<a><b/>t<![CDATA[c]]><!--c--><?p d?></a>";
      expect(parseXml(xml, { limits: { maxNodes: 6 } }).children).toHaveLength(5);
      expect(thrown(() => parseXml(xml, { limits: { maxNodes: 5 } }))).toMatchObject({ limit: "maxNodes", maximum: 5 });
    });

    it("replaces only the limits it is given", () => {
      expect(thrown(() => parseXml("<a><b/></a>", { limits: { maxDepth: 1 } }))).toMatchObject({ limit: "maxDepth" });
      expect(parseXml(`<a x="1"/>`, { limits: { maxDepth: 1 } }).attributes).toHaveLength(1);
    });
  });

  describe("security fixtures", () => {
    const xxe = '<?xml version="1.0"?><!DOCTYPE a [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><a>&xxe;</a>';
    const lolz = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;"><!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">]><lolz>&lol4;</lolz>`;

    it.each([
      ["an external entity (XXE)", xxe],
      ["entities that expand into each other (billion laughs)", lolz],
      ["a parameter entity that loads a file", '<!DOCTYPE a [<!ENTITY % p SYSTEM "http://example.org/x.dtd">%p;]><a/>'],
      ["an external DTD", '<!DOCTYPE a SYSTEM "http://example.org/a.dtd"><a/>'],
      ["a DOCTYPE without a subset", "<!DOCTYPE html><a/>"],
    ])("rejects a DOCTYPE with %s before it declares or expands anything", (_name, xml) => {
      const error = thrownAs(SecurityError, () => parseXml(xml, { path: "evil.xml" }));
      expect(error).toMatchObject({ limit: "doctype", maximum: 0 });
      expect(error.message).toBe(
        'The document "evil.xml" has a DOCTYPE declaration, which the runtime rejects so that no entity is declared or read.',
      );
    });

    it("rejects a DOCTYPE in bytes of every encoding it can arrive in, and reads one inside a comment or a CDATA section as data", () => {
      const doctype = '<!DOCTYPE a [<!ENTITY x "y">]><a/>';
      const utf16 = (text: string, order: readonly [number, number]): Uint8Array =>
        Uint8Array.from([
          ...order,
          ...[...text].flatMap((char) => {
            const unit = char.charCodeAt(0);
            return order[0] === 0xff ? [unit & 0xff, unit >> 8] : [unit >> 8, unit & 0xff];
          }),
        ]);
      const encoder = new TextEncoder();
      for (const bytes of [
        utf16(doctype, [0xff, 0xfe]),
        utf16(doctype, [0xfe, 0xff]),
        Uint8Array.from([0xef, 0xbb, 0xbf, ...encoder.encode(doctype)]),
        encoder.encode(`<?xml version="1.0" encoding="ISO-8859-1"?>${doctype}`),
      ]) {
        expect(thrown(() => parseXml(bytes))).toMatchObject({ limit: "doctype" });
      }
      expect(parseXml("<a><!-- <!DOCTYPE a> --><![CDATA[<!DOCTYPE a>]]></a>").children).toHaveLength(2);
      expect(issueOf(thrown(() => parseXml("<!doctype a><a/>")))).toMatchObject({
        rule: "assesskit/xml/not-well-formed",
      });
    });

    it("reads no entity but the predefined ones: an entity that no DOCTYPE declares is an error", () => {
      const error = thrown(() => parseXml("<a>&xxe;</a>"));
      expect(issueOf(error)).toMatchObject({ rule: "assesskit/xml/not-well-formed" });
      expect(error).toMatchObject({ cause: expect.any(Error) });
    });

    it("rejects input over the default size without reading it", () => {
      const error = thrown(() => parseXml(new Uint8Array(DEFAULT_XML_LIMITS.maxBytes + 1)));
      expect(error).toMatchObject({ limit: "maxBytes", maximum: DEFAULT_XML_LIMITS.maxBytes });
      expect(thrown(() => parseXml(`<a>${"x".repeat(DEFAULT_XML_LIMITS.maxBytes)}</a>`))).toMatchObject({
        limit: "maxBytes",
      });
    });

    it("rejects deep nesting at the default depth before it reads the rest", () => {
      const error = thrown(() => parseXml("<a>".repeat(100_000)));
      expect(error).toBeInstanceOf(SecurityError);
      expect(error).toMatchObject({ limit: "maxDepth", maximum: 256 });
      expect(parseXml(`${"<a>".repeat(256)}${"</a>".repeat(256)}`).name).toBe("a");
    });

    it("rejects more attributes than the default allows on one element", () => {
      const attributes = Array.from({ length: 257 }, (_, index) => ` a${index}="1"`).join("");
      expect(thrown(() => parseXml(`<a${attributes}/>`))).toMatchObject({ limit: "maxAttributes", maximum: 256 });
    });
  });

  describe("errors", () => {
    it.each([
      ["a mismatched end tag", "<a><b></a>", 1],
      ["an unclosed element", "<a><b/>", 1],
      ["two roots", "<a/>\n<b/>", 2],
      ["no root", "", 1],
      ["text outside the root", "\n\nx<a/>", 3],
      ["an unbound prefix", "<p:a/>", 1],
      ["a repeated attribute", '<a x="1" x="2"/>', 1],
      ["a control character", "<a>\n\u0001</a>", 2],
      ["a malformed character reference", "<a>&#0;</a>", 1],
      ["a lone ampersand", "<a>&</a>", 1],
      ["a less-than sign in an attribute value", '<a x="<"/>', 1],
    ])("reports %s on the line where the parser stopped", (_name, xml, line) => {
      const error = thrownAs(ReadError, () => parseXml(xml, { path: "bad.xml" }));
      expect(error.issues).toHaveLength(1);
      const issue = issueOf(error);
      expect(issue).toMatchObject({
        severity: "error",
        rule: "assesskit/xml/not-well-formed",
        location: { path: "bad.xml", line },
      });
      expect(issue.location?.column).toBeGreaterThanOrEqual(1);
      expect(issue.message).toMatch(/^The document "bad\.xml" is not well-formed: .+\.$/);
      expect(error.message).toBe(`${issue.message} (line ${line}, column ${issue.location?.column})`);
    });

    it.each([
      ["a lone high surrogate in text", "<a>\ud800</a>", 1, 4],
      ["a high surrogate that no low surrogate follows", "<a b='x'>a\ud800b</a>", 1, 11],
      ["a lone low surrogate in an attribute value", '<a\n b="\udc00"/>', 2, 5],
      ["a lone surrogate in a comment", "<a><!--\ud83d--></a>", 1, 8],
    ])("rejects %s, which is no character", (_name, xml, line, column) => {
      expect(issueOf(thrown(() => parseXml(xml, { path: "bad.xml" })))).toMatchObject({
        rule: "assesskit/xml/not-well-formed",
        location: { path: "bad.xml", line, column },
      });
      expect(parseXml("<a>\ud83d\ude00</a>").children).toEqual([text("😀")]);
    });

    it.each([
      ["a trailing space", '<a xmlns="urn:a "/>'],
      ["a no-break space", '<p:a xmlns:p="\u00a0urn:a"/>'],
      ["a byte order mark", '<a xmlns="urn:a\ufeff"/>'],
    ])(
      "rejects a namespace declaration with %s, which the parser would strip from the namespace of the element",
      (_name, xml) => {
        expect(issueOf(thrown(() => parseXml(xml, { path: "bad.xml" })))).toMatchObject({
          rule: "assesskit/xml/namespace",
          location: { path: "bad.xml", line: 1, column: 1 },
        });
      },
    );

    it.each([
      ["an element whose local name starts with a digit", '<p:1 xmlns:p="urn:p"/>'],
      ["an attribute whose local name starts with a hyphen", '<a xmlns:p="urn:p" p:-x="1"/>'],
      ["a declaration of a prefix that starts with a digit", '<a xmlns:1p="urn:p"/>'],
    ])("rejects %s: a qualified name has names without a colon on both sides of it", (_name, xml) => {
      expect(issueOf(thrown(() => parseXml(xml, { path: "bad.xml" })))).toMatchObject({
        rule: "assesskit/xml/not-well-formed",
        location: { path: "bad.xml", line: 1, column: 1 },
      });
    });

    it("reports the column of the character that ends a malformed construct", () => {
      expect(issueOf(thrown(() => parseXml("<a>\u0001</a>")))).toMatchObject({ location: { line: 1, column: 4 } });
      expect(issueOf(thrown(() => parseXml("<a><b></a>")))).toMatchObject({ location: { line: 1, column: 10 } });
    });

    it("names the document by its position only, when it has no path", () => {
      expect(issueOf(thrown(() => parseXml("<a>")))).toMatchObject({
        message: "The document is not well-formed: unclosed tag: a.",
      });
    });

    it("rejects XML 1.1, which has other rules for characters and names", () => {
      const issue = issueOf(thrown(() => parseXml('<?xml version="1.1"?><a/>')));
      expect(issue).toMatchObject({ rule: "assesskit/xml/version" });
      expect(issue.message).toBe('The document declares XML version "1.1", but the runtime reads XML 1.0.');
    });

    it("throws DataError for input of other types, as JavaScript or JSON pass it", () => {
      for (const input of ["1", "null", "[]", '{"a":1}']) {
        expect(() => parseXml(JSON.parse(input))).toThrow(DataError);
      }
      expect(() => parseXml(JSON.parse("1"))).toThrow("The XML input must be a string or a Uint8Array, found 1.");
      expect(() => parseXml("<a/>", JSON.parse("null"))).toThrow(
        "The options object is invalid: expected an object, found null",
      );
      expect(() => parseXml("<a/>", JSON.parse('{"limits":{"maxByte":5}}'))).toThrow('unexpected property "maxByte"');
      expect(() =>
        ElementReader.open("<a/>", { module: "demo", namespaces: [] }, "The demo", JSON.parse('{"bogus":1}')),
      ).toThrow('unexpected property "bogus"');
      expect(() => parseXml("<a/>", JSON.parse('{"bogus":1}'))).toThrow('unexpected property "bogus"');
      expect(() => parseXml("<a/>", JSON.parse('{"path": 5}'))).toThrow(
        "The options object is invalid at path: expected a string, found 5.",
      );
      expect(() => parseXml("<a/>", JSON.parse('{"path": null}'))).toThrow(
        "The options object is invalid at path: expected a string, found null.",
      );
      expect(() => parseXml("<a/>", JSON.parse('{"limits": null}'))).toThrow(
        "The options object is invalid at limits: expected an object, found null.",
      );
      expect(() => parseXml("<a/>", JSON.parse('{"limits": {"maxBytes": "5"}}'))).toThrow(
        'The options object is invalid at limits.maxBytes: expected a number, found "5".',
      );
      expect(() => parseXml("<a/>", JSON.parse('{"limits": {"maxDepth": 0}}'))).toThrow(
        "The options object is invalid at limits.maxDepth: expected a value of at least 1, found 0.",
      );
      expect(() => parseXml("<a/>", JSON.parse('{"limits": {"maxNodes": null}}'))).toThrow(
        "The options object is invalid at limits.maxNodes: expected a number, found null.",
      );
    });
  });
});

describe("reading a tree without mapping it", () => {
  const root = parsed(
    '<a xmlns:p="urn:p" x="1" p:x="2" xml:lang="en">t1<b/><!--c-->t2<![CDATA[<cd>]]><p:c/><?pi d?></a>',
  );

  it("returns the child elements in document order, without the nodes between them", () => {
    expect(listChildElements(root).map(({ name }) => name)).toEqual(["b", "c"]);
    expect(listChildElements(element("e"))).toEqual([]);
  });

  it("returns the value of an attribute of a namespace, the unqualified one by default, or undefined", () => {
    expect(findAttribute(root, "x")).toBe("1");
    expect(findAttribute(root, "x", { namespace: "urn:p" })).toBe("2");
    expect(findAttribute(root, "lang", { namespace: XML_NAMESPACE })).toBe("en");
    expect(findAttribute(root, "y")).toBeUndefined();
    expect(findAttribute(root, "lang")).toBeUndefined();
    expect(() => findAttribute(root, "x", JSON.parse('{"bogus":1}'))).toThrow('unexpected property "bogus"');
  });

  it("joins the text and CDATA children of an element, and leaves out comments, instructions and child elements", () => {
    expect(collectText(root)).toBe("t1t2<cd>");
    expect(collectText(element("e"))).toBe("");
  });
});

describe("read errors and locations", () => {
  it("builds a ReadError with one issue and the position in its message", () => {
    const error = createReadError("assesskit/xml/example", "The example is wrong.", {
      location: {
        path: "a.xml",
        line: 3,
        column: 7,
      },
    });
    expect(error).toBeInstanceOf(ReadError);
    expect(error.message).toBe("The example is wrong. (line 3, column 7)");
    expect(error.issues).toEqual([
      {
        severity: "error",
        rule: "assesskit/xml/example",
        message: "The example is wrong.",
        location: { path: "a.xml", line: 3, column: 7 },
      },
    ]);
    expect(createReadError("assesskit/xml/example", "m").issues[0]).not.toHaveProperty("location");
  });

  it("carries the error it reports as its cause, and has none unless given one", () => {
    const cause = new DataError("The text is not an integer.");
    expect(createReadError("assesskit/xml/example", "m", { cause }).cause).toBe(cause);
    expect("cause" in createReadError("assesskit/xml/example", "m")).toBe(false);
    expect(() => createReadError("assesskit/xml/example", "m", JSON.parse('{"bogus":1}'))).toThrow(
      'unexpected property "bogus"',
    );
  });

  it("refuses options that are not an object", () => {
    expect(() => createReadError("assesskit/xml/example", "m", JSON.parse("null"))).toThrow(
      "The options object is invalid: expected an object, found null",
    );
    expect(() => locateElement(parseXml("<a/>"), "x.xml", JSON.parse("null"))).toThrow(
      "The options object is invalid: expected an object, found null",
    );
    expect(() => locateElement(parseXml("<a/>"), "x.xml", JSON.parse('{"bogus":1}'))).toThrow(
      'unexpected property "bogus"',
    );
  });

  it("takes the location of an element from its start tag", () => {
    expect(locateElement(parseXml("<a>\n  <b/></a>"), "x.xml")).toEqual({ path: "x.xml", line: 1, column: 1 });
    const b = listChildElements(parseXml("<a>\n  <b/></a>"))[0];
    expect(b && locateElement(b, undefined)).toEqual({ path: undefined, line: 2, column: 3 });
  });

  it("adds the path of the element names when the caller tracks it", () => {
    expect(locateElement(parseXml("<a/>"), "x.xml", { trail: "r/a" })).toEqual({
      path: "x.xml",
      line: 1,
      column: 1,
      element: "r/a",
    });
  });
});

describe("serializing", () => {
  it("writes the declaration and the element, with text as the tree has it", () => {
    const tree = element("a", [
      text("1"),
      element("b"),
      text(" 2 "),
      { kind: "comment", value: " c " },
      { kind: "instruction", target: "pi", data: "d" },
    ]);
    expect(serializeXml(tree)).toBe(`${DECLARATION}<a>1<b/> 2 <!-- c --><?pi d?></a>`);
  });

  it("escapes what the syntax needs in text and in attribute values", () => {
    const tree = element("a", [text('x & y < z > "q" \r')], [attribute("v", "a&b<c>\"d'\t\n\r")]);
    expect(serializeXml(tree)).toBe(
      `${DECLARATION}<a v="a&amp;b&lt;c&gt;&quot;d'&#9;&#10;&#13;">x &amp; y &lt; z &gt; "q" &#13;</a>`,
    );
  });

  it("writes a CDATA section, splitting it where its text has ]]>", () => {
    expect(serializeXml(element("a", [{ kind: "cdata", value: "a]]>b" }]))).toBe(
      `${DECLARATION}<a><![CDATA[a]]]]><![CDATA[>b]]></a>`,
    );
    expect(parsed(serializeXml(element("a", [{ kind: "cdata", value: "a]]>b" }]))).children).toEqual([
      { kind: "cdata", value: "a]]" },
      { kind: "cdata", value: ">b" },
    ]);
  });

  it("writes a processing instruction without data as its target alone", () => {
    expect(serializeXml(element("a", [{ kind: "instruction", target: "pi", data: "" }]))).toBe(
      `${DECLARATION}<a><?pi?></a>`,
    );
  });

  it("declares the namespaces that the tree uses and does not declare", () => {
    const tree = element(
      "a",
      [element("c", [], [attribute("x", "1", "urn:b", "b")], "urn:b", "b"), element("d", [], [], "")],
      [attribute("lang", "en", XML_NAMESPACE, "xml")],
      "urn:a",
    );
    expect(serializeXml(tree)).toBe(
      `${DECLARATION}<a xml:lang="en" xmlns="urn:a"><b:c b:x="1" xmlns:b="urn:b"/><d xmlns=""/></a>`,
    );
  });

  it("keeps the declarations the tree has, and declares nothing that is in scope", () => {
    const xml = `${DECLARATION}<a xmlns="urn:a" xmlns:b="urn:b"><b:c><d/></b:c></a>`;
    expect(serializeXml(parseXml(xml))).toBe(xml);
  });

  it("writes a parsed document unchanged when it is in canonical form", () => {
    const xml = `${DECLARATION}<a x="1"><!--c--><b y="&amp;">t &lt; u<![CDATA[v]]></b><?p q?></a>`;
    expect(serializeXml(parseXml(xml))).toBe(xml);
  });

  describe("errors", () => {
    it.each([
      [
        "a character XML 1.0 does not allow in text",
        element("a", [text("a\u0001b")]),
        "A text node has the character U+0001, which XML 1.0 does not allow. It is in a.",
      ],
      [
        "a lone surrogate in an attribute value",
        element("a", [], [attribute("x", "\uD800")]),
        "The value of the attribute x has the character U+D800, which XML 1.0 does not allow. It is in a.",
      ],
      ["a name with a colon", element("a:b"), 'The name of an element must be a name without a colon, found "a:b".'],
      [
        "a name that starts with a digit",
        element("1a"),
        'The name of an element must be a name without a colon, found "1a".',
      ],
      [
        "a prefix without a namespace",
        element("a", [], [], "", "p"),
        "The element a has a prefix but no namespace. It is in a.",
      ],
      [
        "an attribute in a namespace without a prefix",
        element("a", [], [attribute("x", "1", "urn:b")]),
        "The attribute x is in a namespace but has no prefix. It is in a.",
      ],
      [
        "an attribute with a prefix and no namespace",
        element("a", [], [attribute("x", "1", "", "p")]),
        "The attribute p:x has a prefix but no namespace. It is in a.",
      ],
      [
        "the prefix xml for another namespace",
        element("a", [], [attribute("x", "1", "urn:b", "xml")]),
        'The attribute xml:x uses the prefix "xml" and the XML namespace apart. It is in a.',
      ],
      [
        "a declaration that is not xmlns",
        element("a", [], [attribute("x", "1", XMLNS_NAMESPACE)]),
        "The attribute x is not a namespace declaration, `xmlns` or `xmlns:prefix`. It is in a.",
      ],
      [
        "an attribute twice",
        element("a", [], [attribute("x", "1"), attribute("x", "2")]),
        "The attribute x occurs twice. It is in a.",
      ],
      [
        "one prefix for two namespaces on an element",
        element("a", [], [attribute("x", "1", "urn:b", "p")], "urn:a", "p"),
        'The prefix "p" stands for two namespaces on one element. It is in a.',
      ],
      [
        "a comment with two hyphens",
        element("a", [{ kind: "comment", value: "a--b" }]),
        'A comment must not contain "--" or end with "-". It is in a.',
      ],
      [
        "a comment that ends with a hyphen",
        element("a", [{ kind: "comment", value: "a-" }]),
        'A comment must not contain "--" or end with "-". It is in a.',
      ],
      [
        "a processing instruction named xml",
        element("a", [{ kind: "instruction", target: "XML", data: "" }]),
        'A processing instruction must not have the target "xml" or contain "?>". It is in a.',
      ],
      [
        "a processing instruction with ?>",
        element("a", [{ kind: "instruction", target: "p", data: "a?>b" }]),
        'A processing instruction must not have the target "xml" or contain "?>". It is in a.',
      ],
    ])("rejects %s", (_name, tree, message) => {
      expect(thrownAs(DataError, () => serializeXml(tree)).message).toBe(message);
    });

    it("names the path of the element that has the problem", () => {
      const tree = element("a", [element("b", [element("c", [text("\u0000")])])]);
      expect(() => serializeXml(tree)).toThrow(
        "A text node has the character U+0000, which XML 1.0 does not allow. It is in a/b/c.",
      );
    });

    it("throws DataError for input of other types, as JavaScript or JSON pass it", () => {
      expect(() => serializeXml(JSON.parse("null"))).toThrow("The root must be an element, found null.");
      expect(() => serializeXml(JSON.parse('{"kind":"text","value":"x"}'))).toThrow(
        "The root must be an element, found a node of the kind",
      );
      expect(() =>
        serializeXml(JSON.parse('{"kind":"element","namespace":"","name":"a","attributes":{},"children":[]}')),
      ).toThrow("The attributes of the element a must be an array, found an object.");
      expect(() =>
        serializeXml(JSON.parse('{"kind":"element","namespace":"","name":"a","attributes":[],"children":[1]}')),
      ).toThrow("A node must be an object, found 1.");
      expect(() =>
        serializeXml(
          JSON.parse('{"kind":"element","namespace":"","name":"a","attributes":[],"children":[{"kind":"pi"}]}'),
        ),
      ).toThrow('A node must have the kind "element", "text", "cdata", "comment" or "instruction", found "pi".');
      expect(() =>
        serializeXml(JSON.parse('{"kind":"element","namespace":5,"name":"a","attributes":[],"children":[]}')),
      ).toThrow("The namespace of the element a must be a string, found 5.");
      expect(() =>
        serializeXml(JSON.parse('{"kind":"element","namespace":"","name":"a","attributes":[1],"children":[]}')),
      ).toThrow("An attribute must be an object, found 1.");
    });
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const guide = readFileSync(new URL("../../../docs/runtime/xml.md", import.meta.url), "utf8");
    const modules = {
      "@assesskit/runtime/xml": await import("../src/xml/index.js"),
      "../xml/internal.js": await import("../src/xml/internal.js"),
    };
    expect(await runGuideSamples(guide, modules)).toBeGreaterThan(0);
  });
});

describe("properties", () => {
  const Names = ["a", "b", "qti-item", "x1"] as const;
  /** Prefix and namespace of an element: no namespace, the default namespace, and two prefixes. */
  const ElementNames: readonly (readonly [string | undefined, string])[] = [
    [undefined, ""],
    [undefined, "urn:a"],
    ["p", "urn:a"],
    ["q", "urn:b"],
  ];
  const AttributeNames: readonly (readonly [string | undefined, string])[] = [
    [undefined, ""],
    ["p", "urn:a"],
    ["q", "urn:b"],
  ];
  const Characters = fc.constantFrom(..."ab 1&<>\"'\t\n\ré€\u{1F600}]".split(/(?:)/u));
  const characters = fc.array(Characters, { maxLength: 8 }).map((units) => units.join(""));
  const attributesOf = fc
    .uniqueArray(fc.tuple(fc.constantFrom(...Names), fc.constantFrom(...AttributeNames)), {
      maxLength: 4,
      selector: ([name, [prefix]]) => `${prefix}:${name}`,
    })
    .chain((keys) =>
      fc
        .array(characters, { minLength: keys.length, maxLength: keys.length })
        .map((values) =>
          keys.map(
            ([name, [prefix, namespace]], index): XmlAttribute =>
              attribute(name, values[index] ?? "", namespace, prefix),
          ),
        ),
    );
  // A parser reads a carriage return in a CDATA section, comment or instruction as a line feed, so the
  // trees avoid it there.
  const lineEnds = characters.map((value) => value.replaceAll("\r", ""));
  const leaf: fc.Arbitrary<XmlNode> = fc.oneof(
    characters.filter((value) => value !== "").map((value): XmlNode => text(value)),
    lineEnds.map((value): XmlNode => ({ kind: "cdata", value: value.replaceAll("]", "") })),
    lineEnds.map((value): XmlNode => ({ kind: "comment", value: value.replaceAll("-", "") })),
    lineEnds.map((value): XmlNode => ({ kind: "instruction", target: "pi", data: value.trim() })),
  );
  const tree: fc.Arbitrary<XmlElement> = fc.letrec<{ element: XmlElement; node: XmlNode }>((self) => ({
    node: fc.oneof({ depthSize: "small" }, leaf, self("element")),
    element: fc
      .tuple(
        fc.constantFrom(...Names),
        fc.constantFrom(...ElementNames),
        attributesOf,
        fc.array(self("node"), { maxLength: 4 }),
      )
      .map(([name, [prefix, namespace], attributes, children]) =>
        element(name, children, attributes, namespace, prefix),
      ),
  })).element;

  /** Merges adjacent text nodes and drops empty ones and the namespace declarations, which a parse merges and the writer derives. */
  function canonical(node: XmlNode): XmlNode {
    if (node.kind !== "element") return node;
    const children: XmlNode[] = [];
    for (const child of node.children.map(canonical)) {
      const last = children.at(-1);
      if (child.kind === "text" && last?.kind === "text")
        children[children.length - 1] = text(last.value + child.value);
      else children.push(child);
    }
    const { line: _line, column: _column, ...rest } = node;
    return { ...rest, attributes: node.attributes.filter(({ namespace }) => namespace !== XMLNS_NAMESPACE), children };
  }

  it("places each element at the line and column that a count of the characters before its start tag gives", () => {
    /** The line and column of an offset, one UTF-16 unit at a time: `\r\n`, `\r` and `\n` end a line, a low surrogate has no column. */
    const reference = (text: string, offset: number): [number, number] => {
      let [line, column] = [1, 1];
      for (let index = text.startsWith("﻿") ? 1 : 0; index < offset; index++) {
        const unit = text[index];
        if (unit === "\n" || (unit === "\r" && text[index + 1] !== "\n")) [line, column] = [line + 1, 1];
        else if (unit !== "\r" && !/[\uDC00-\uDFFF]/.test(unit ?? "")) column++;
      }
      return [line, column];
    };
    const piece = fc.oneof(
      fc.constantFrom("\n", "\r", "\r\n", "x", "é", "\u{1F600}", " "),
      fc.constantFrom("<e/>", '<e\r\n a="1"/>', "<e>\r</e>"),
    );
    fc.assert(
      fc.property(fc.boolean(), fc.array(piece, { maxLength: 30 }), (marked, pieces) => {
        const text = `${marked ? "﻿" : ""}<r>${pieces.join("")}</r>`;
        const root = parseXml(text);
        const starts = [...text.matchAll(/<[re]/g)].map(({ index }) => reference(text, index));
        const elements = [root, ...root.children.filter((child): child is XmlElement => child.kind === "element")];
        expect(elements.map(({ line, column }) => [line, column])).toEqual(starts);
      }),
      { numRuns: 300 },
    );
  });

  it("parseXml reads back what serializeXml writes, with its namespaces", () => {
    fc.assert(
      fc.property(tree, (root) => {
        expect(canonical(parseXml(serializeXml(root)))).toEqual(canonical(root));
      }),
      { numRuns: 300 },
    );
  });

  it("serializeXml writes the same text for a tree read from its own output", () => {
    fc.assert(
      fc.property(tree, (root) => {
        const written = serializeXml(root);
        expect(serializeXml(parseXml(written))).toBe(written);
      }),
      { numRuns: 300 },
    );
  });

  it("parseXml accepts every document within the limits it is given and rejects none for other reasons", () => {
    fc.assert(
      fc.property(tree, (root) => {
        const written = serializeXml(root);
        expect(() =>
          parseXml(written, { limits: { maxBytes: new TextEncoder().encode(written).length } }),
        ).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  /** Mutated text and mutated bytes of documents that the writer wrote. */
  const hostileInputs = fc
    .tuple(tree.map(serializeXml), mutations, fc.boolean())
    .map(([document, changes, asBytes]) =>
      asBytes ? mutateBytes(new TextEncoder().encode(document), changes) : mutateText(document, changes),
    );

  it("parseXml reads a mutated document into a tree that serializeXml writes back, or refuses it with a ReadError or a SecurityError", () => {
    fc.assert(
      fc.property(hostileInputs, (input) => {
        let root: XmlElement;
        try {
          root = parseXml(input);
        } catch (error) {
          expectOutcome(() => {
            throw error;
          });
          return;
        }
        const written = serializeXml(root);
        expect(serializeXml(parseXml(written))).toBe(written);
      }),
      FUZZ,
    );
  });

  it("parseXml under small limits reads a document or refuses it with a SecurityError, and never builds a tree beyond a limit", () => {
    const small = fc.record(
      {
        maxBytes: fc.integer({ min: 1, max: 400 }),
        maxDepth: fc.integer({ min: 1, max: 6 }),
        maxAttributes: fc.integer({ min: 1, max: 4 }),
        maxNodes: fc.integer({ min: 1, max: 12 }),
      },
      { requiredKeys: [] },
    );
    const sizeOf = (node: XmlNode): { depth: number; nodes: number } => {
      if (node.kind !== "element") return { depth: 0, nodes: 1 };
      const inner = node.children.map(sizeOf);
      return {
        depth: 1 + Math.max(0, ...inner.map(({ depth }) => depth)),
        nodes: 1 + inner.reduce((sum, { nodes }) => sum + nodes, 0),
      };
    };
    fc.assert(
      fc.property(tree.map(serializeXml), small, (document, limits) => {
        const { maxDepth = DEFAULT_XML_LIMITS.maxDepth, maxNodes = DEFAULT_XML_LIMITS.maxNodes } = limits;
        try {
          const { depth, nodes } = sizeOf(parseXml(document, { limits }));
          expect(depth).toBeLessThanOrEqual(maxDepth);
          expect(nodes).toBeLessThanOrEqual(maxNodes);
        } catch (error) {
          expect(error).toBeInstanceOf(SecurityError);
        }
      }),
      FUZZ,
    );
  });

  it("resolveIncludes expands hostile includes within the limits, or refuses them with a ReadError or a SecurityError", () => {
    const hrefs = fc.constantFrom(
      "a.xml",
      "b.xml",
      "c.xml",
      "../a.xml",
      "",
      "b.xml#x",
      "http://example.com/a.xml",
      "/b.xml",
      "missing.xml",
    );
    const include = fc
      .tuple(hrefs, fc.boolean(), fc.constantFrom("", ' xpointer="x"', ' parse="text"'))
      .map(
        ([href, fallback, extra]) =>
          `<xi:include href="${href}"${extra}>${fallback ? "<xi:fallback><f/></xi:fallback>" : ""}</xi:include>`,
      );
    const document = fc
      .array(fc.oneof(include, include, fc.constant("<e/>"), fc.constant("<xi:fallback/>")), { maxLength: 4 })
      .map((children) => parseXml(`<r xmlns:xi="${XINCLUDE_NAMESPACE}">${children.join("")}</r>`));
    const limits = fc.record(
      {
        maxDepth: fc.integer({ min: 1, max: 6 }),
        maxNodes: fc.integer({ min: 1, max: 60 }),
        maxIncludeDepth: fc.integer({ min: 1, max: 4 }),
      },
      { requiredKeys: [] },
    );
    const sizeOf = (node: XmlNode): { depth: number; nodes: number; includes: number } => {
      if (node.kind !== "element") return { depth: 0, nodes: 1, includes: 0 };
      const inner = node.children.map(sizeOf);
      return {
        depth: 1 + Math.max(0, ...inner.map(({ depth }) => depth)),
        nodes: 1 + inner.reduce((sum, { nodes }) => sum + nodes, 0),
        includes:
          (node.namespace === XINCLUDE_NAMESPACE && node.name === "include" ? 1 : 0) +
          inner.reduce((sum, { includes }) => sum + includes, 0),
      };
    };
    fc.assert(
      fc.property(fc.tuple(document, document, document), limits, (world, limited) => {
        const documents = new Map(["a.xml", "b.xml", "c.xml"].map((href, index) => [href, world[index]]));
        const resolve = (href: string): XmlElement => {
          const found = documents.get(href);
          if (found === undefined) throw new Error(`${href} is missing`);
          return found;
        };
        const { maxDepth = DEFAULT_XML_LIMITS.maxDepth, maxNodes = DEFAULT_XML_LIMITS.maxNodes } = limited;
        try {
          const { depth, nodes, includes } = sizeOf(resolveIncludes(world[0], "a.xml", resolve, { limits: limited }));
          expect(includes).toBe(0);
          expect(depth).toBeLessThanOrEqual(maxDepth);
          expect(nodes).toBeLessThanOrEqual(maxNodes);
        } catch (error) {
          expectOutcome(() => {
            throw error;
          });
        }
      }),
      FUZZ,
    );
  });

  it("resolveIncludes gives a tree without includes back with the same content", () => {
    fc.assert(
      fc.property(tree, (root) => {
        expect(resolveIncludes(root, "a.xml", () => root)).toEqual(root);
      }),
      { numRuns: 100 },
    );
  });
});
