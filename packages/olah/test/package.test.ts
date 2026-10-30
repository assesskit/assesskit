import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  CP_NAMESPACE,
  CPX_NAMESPACE,
  DataError,
  DEFAULT_ZIP_LIMITS,
  DRD_NAMESPACE,
  dependencyClosure,
  LOM_NAMESPACE,
  MANIFEST_SCHEMAS,
  type Manifest,
  openPackage,
  type PackageFiles,
  packageResolvers,
  parseXml,
  QTI_METADATA_NAMESPACE,
  type QtiPackage,
  RESOURCE_TYPES,
  ReadError,
  type Resource,
  readLtiLink,
  readManifest,
  readPackage,
  resourcePath,
  SecurityError,
  writeManifest,
  writePackage,
} from "../src/index.js";
import { manifests } from "./package-generators.js";
import { buildZip, bytes, concat, type RawEntry } from "./zip-builder.js";

const FIXTURES = join(import.meta.dirname, "fixtures/zip");
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)));
const expectations: Readonly<Record<string, readonly { name: string; size: number; sha256: string }[]>> = JSON.parse(
  readFileSync(join(FIXTURES, "zips.json"), "utf8"),
);

const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** Returns the error a function throws, after checking that it is of a class. */
function thrownAs<T extends Error>(type: new (...args: never[]) => T, run: () => unknown): T {
  try {
    run();
  } catch (error) {
    if (error instanceof type) return error;
    throw new Error(`Expected a ${type.name}, found ${String(error)}.`);
  }
  throw new Error("The function did not throw.");
}

const issueCode = (run: () => unknown): string | undefined => thrownAs(ReadError, run).issues[0]?.code;
const securityLimit = (run: () => unknown): string => thrownAs(SecurityError, run).limit;

/** Drops the positions `parseXml` adds and the namespace declarations from everything in a model, so that kept XML compares. */
function bare(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, member: unknown) => {
      if (key === "line" || key === "column") return undefined;
      if (key === "attributes" && Array.isArray(member)) {
        return member.filter((attribute) => attribute.namespace !== "http://www.w3.org/2000/xmlns/");
      }
      return member;
    }),
  );
}

const SCHEMA = "<metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata>";

function manifestXml(
  resources: string,
  options: { root?: string; metadata?: string; organizations?: string } = {},
): string {
  const { root = "", metadata = SCHEMA, organizations = "<organizations/>" } = options;
  return `<manifest xmlns="${CP_NAMESPACE}" xmlns:qmd="${QTI_METADATA_NAMESPACE}" xmlns:cpx="${CPX_NAMESPACE}" xmlns:drd="${DRD_NAMESPACE}" xmlns:lom="${LOM_NAMESPACE}" identifier="m" ${root}>${metadata}${organizations}${resources}</manifest>`;
}

const resourceXml = (identifier: string, type: string, href: string, rest = ""): string =>
  `<resource identifier="${identifier}" type="${type}" href="${href}"><file href="${href}"/>${rest}</resource>`;

const resources = (...items: string[]): string => `<resources>${items.join("")}</resources>`;

/** A package of the given files, in memory, with a manifest that is valid for the resources. */
function packageOf(manifest: string, files: Readonly<Record<string, string>> = {}): QtiPackage {
  const entries: RawEntry[] = [
    { name: "imsmanifest.xml", data: bytes(manifest) },
    ...Object.entries(files).map(([name, text]): RawEntry => ({ name, data: bytes(text) })),
  ];
  return readPackage(buildZip(entries));
}

const ASI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";
const item = (identifier: string, body = ""): string =>
  `<qti-assessment-item xmlns="${ASI}" xmlns:xi="http://www.w3.org/2001/XInclude" identifier="${identifier}" title="${identifier}" adaptive="false" time-dependent="false">${body}</qti-assessment-item>`;

describe("dependencyClosure", () => {
  const manifest = readManifest(
    manifestXml(
      resources(
        resourceXml(
          "test",
          "imsqti_test_xmlv3p0",
          "test.xml",
          '<dependency identifierref="i1"/><dependency identifierref="i2"/>',
        ),
        resourceXml("i1", "imsqti_item_xmlv3p0", "i1.xml", '<dependency identifierref="s"/>'),
        resourceXml(
          "i2",
          "imsqti_item_xmlv3p0",
          "i2.xml",
          '<dependency identifierref="s"/><dependency identifierref="i1"/>',
        ),
        resourceXml("s", "imsqti_stimulus_xmlv3p0", "s.xml", '<dependency identifierref="m1"/>'),
        resourceXml("m1", "webcontent", "m1.png", '<dependency identifierref="s"/>'),
        resourceXml("lonely", "webcontent", "x.png"),
      ),
    ),
  );
  const ids = (start: string): string[] => dependencyClosure(manifest, start).map(({ identifier }) => identifier);

  it("[K8] returns the resource, then each dependency once, depth first in the order of the dependency elements", () => {
    expect(ids("test")).toEqual(["test", "i1", "s", "m1", "i2"]);
    expect(ids("i2")).toEqual(["i2", "s", "m1", "i1"]);
  });

  it("[K8] ends a cycle where it closes and returns a resource without dependencies alone", () => {
    expect(ids("s")).toEqual(["s", "m1"]);
    expect(ids("lonely")).toEqual(["lonely"]);
  });

  it("[K8] throws a DataError for a resource that is not in the manifest and for a dependency that names none", () => {
    expect(() => dependencyClosure(manifest, "missing")).toThrow(DataError);
    const dangling: Manifest = {
      ...manifest,
      resources: [{ ...(manifest.resources[0] as Resource), dependencies: ["nowhere"] }],
    };
    expect(() => dependencyClosure(dangling, "test")).toThrow(/depends on "nowhere"/);
  });

  it("throws a DataError for an argument of another type", () => {
    for (const manifestJson of ["null", '"x"', '{"resources":"x"}']) {
      expect(() => dependencyClosure(JSON.parse(manifestJson), "a"), manifestJson).toThrow(DataError);
    }
    expect(() => dependencyClosure(manifest, JSON.parse("3"))).toThrow(DataError);
  });
});

const LTI_ROOT =
  'xmlns="http://www.imsglobal.org/xsd/imslticc_v1p0" xmlns:blti="http://www.imsglobal.org/xsd/imsbasiclti_v1p0" xmlns:lticm="http://www.imsglobal.org/xsd/imslticm_v1p0" xmlns:lticp="http://www.imsglobal.org/xsd/imslticp_v1p0"';
const lti = (inner: string, root = LTI_ROOT): string =>
  `<cartridge_basiclti_link ${root}>${inner}</cartridge_basiclti_link>`;

describe("readLtiLink", () => {
  it("[K20] reads the title, description, launch URLs, custom properties, extensions and vendor of a link", () => {
    const link = readLtiLink(
      lti(`
        <blti:title>Student Edition</blti:title>
        <blti:description>
          Luggage </blti:description>
        <blti:custom><lticm:property name="item_id">item1</lticm:property><lticm:property name="user"> $User.id </lticm:property></blti:custom>
        <blti:extensions platform="my.lms.com"><lticm:property name="keyname">value</lticm:property></blti:extensions>
        <blti:extensions platform="IMSGlobal.org"><lticm:property name="state">review</lticm:property></blti:extensions>
        <blti:launch_url>http://localhost:8085/provider</blti:launch_url>
        <blti:secure_launch_url>https://localhost:8085/provider</blti:secure_launch_url>
        <blti:icon>ignored</blti:icon>
        <blti:vendor><lticp:code>IMSGlobal.org</lticp:code><lticp:name>IMS</lticp:name></blti:vendor>
        <cartridge_bundle identifierref="ignored"/>`),
    );
    expect(link).toEqual({
      title: "Student Edition",
      description: "Luggage",
      launchUrl: "http://localhost:8085/provider",
      secureLaunchUrl: "https://localhost:8085/provider",
      custom: new Map([
        ["item_id", "item1"],
        ["user", "$User.id"],
      ]),
      extensions: [
        { platform: "my.lms.com", properties: new Map([["keyname", "value"]]) },
        { platform: "IMSGlobal.org", properties: new Map([["state", "review"]]) },
      ],
      vendor: { code: "IMSGlobal.org", name: "IMS" },
    });
  });

  it("[K20] reads a link with only a title, and the relative namespace that the 1EdTech examples declare", () => {
    const link = readLtiLink(
      lti(
        "<blti:title>t</blti:title>",
        LTI_ROOT.replace("http://www.imsglobal.org/xsd/imslticc_v1p0", "/xsd/imslticc_v1p0"),
      ),
    );
    expect(link).toEqual({ title: "t", custom: new Map(), extensions: [] });
  });

  it("[K20] reads a link from bytes and from a parsed element", () => {
    const text = lti("<blti:title>t</blti:title>");
    expect(readLtiLink(bytes(text))).toEqual(readLtiLink(parseXml(text)));
  });

  it("[K20] keeps a custom property with an empty value and an attribute name with a prototype name as data", () => {
    const link = readLtiLink(
      lti('<blti:title>t</blti:title><blti:custom><lticm:property name="__proto__"/></blti:custom>'),
    );
    expect(link.custom.get("__proto__")).toBe("");
  });

  it("[K20] rejects a document that is not a link, has no title, repeats or leaves out a property name, or has a vendor without a code", () => {
    expect(issueCode(() => readLtiLink("<other/>"))).toBe("olah/package/lti-link");
    expect(
      issueCode(() => readLtiLink(lti("<blti:title>t</blti:title>", LTI_ROOT.replace("imslticc_v1p0", "other")))),
    ).toBe("olah/package/lti-link");
    expect(issueCode(() => readLtiLink(lti("<blti:description>d</blti:description>")))).toBe("olah/package/lti-link");
    expect(
      issueCode(() =>
        readLtiLink(
          lti(
            '<blti:title>t</blti:title><blti:custom><lticm:property name="a">1</lticm:property><lticm:property name="a">2</lticm:property></blti:custom>',
          ),
        ),
      ),
    ).toBe("olah/package/lti-property");
    expect(
      issueCode(() =>
        readLtiLink(lti("<blti:title>t</blti:title><blti:custom><lticm:property>1</lticm:property></blti:custom>")),
      ),
    ).toBe("olah/package/missing-attribute");
    expect(
      issueCode(() =>
        readLtiLink(lti("<blti:title>t</blti:title><blti:vendor><lticp:name>n</lticp:name></blti:vendor>")),
      ),
    ).toBe("olah/package/lti-link");
  });

  it("throws a DataError for an argument of another type and rejects a DOCTYPE", () => {
    for (const input of ["null", "3", "[]", "{}"])
      expect(() => readLtiLink(JSON.parse(input)), input).toThrow(DataError);
    expect(() => readLtiLink("<a/>", JSON.parse("null"))).toThrow(DataError);
    expect(() => readLtiLink("<a/>", { path: JSON.parse("3") })).toThrow(DataError);
    expect(securityLimit(() => readLtiLink('<!DOCTYPE a [<!ENTITY x "y">]><a/>'))).toBe("doctype");
  });
});

describe("readManifest", () => {
  const minimal = manifestXml(resources(resourceXml("a", "webcontent", "a.txt")));

  it("[K1][K4][K5] reads the identifier, the xml:base attributes and a resource", () => {
    const manifest = readManifest(
      manifestXml(
        `<resources xml:base="items/">${'<resource identifier="a" type="imsqti_item_xmlv3p0" href="a.xml" xml:base="sub/"><file href="a.xml"/></resource>'}</resources>`,
        { root: 'xml:base="pkg/"' },
      ),
    );
    expect(manifest).toMatchObject({
      identifier: "m",
      base: "pkg/",
      resourcesBase: "items/",
      resources: [
        { identifier: "a", type: "imsqti_item_xmlv3p0", href: "a.xml", base: "sub/", files: [{ href: "a.xml" }] },
      ],
    });
  });

  it("[K1][K5] reads a manifest from text, bytes and a parsed element alike", () => {
    expect(readManifest(bytes(minimal))).toEqual(readManifest(minimal));
    expect(bare(readManifest(parseXml(minimal)))).toEqual(bare(readManifest(minimal)));
  });

  it("[K2] accepts each of the seven schemas and the version 3.0.0, and nothing else", () => {
    expect(MANIFEST_SCHEMAS).toHaveLength(7);
    for (const schema of MANIFEST_SCHEMAS) {
      const metadata = `<metadata><schema>${schema}</schema><schemaversion>3.0.0</schemaversion></metadata>`;
      expect(readManifest(manifestXml(resources(), { metadata })).metadata.schema).toBe(schema);
    }
    const metadata = (schema: string, version: string): string =>
      `<metadata><schema>${schema}</schema><schemaversion>${version}</schemaversion></metadata>`;
    expect(
      issueCode(() => readManifest(manifestXml(resources(), { metadata: metadata("QTI Packages", "3.0.0") }))),
    ).toBe("olah/package/invalid-text");
    expect(
      issueCode(() => readManifest(manifestXml(resources(), { metadata: metadata("qti package", "3.0.0") }))),
    ).toBe("olah/package/invalid-text");
    expect(
      issueCode(() => readManifest(manifestXml(resources(), { metadata: metadata("QTI Package", "3.0.1") }))),
    ).toBe("olah/package/invalid-text");
  });

  it("[K2][Q18][Q27] reads the LOM and the curriculum standards of the manifest metadata", () => {
    const metadata = `<metadata><schema>QTI Item</schema><schemaversion>3.0.0</schemaversion>
      <csmd:curriculumStandardsMetadataSet xmlns:csmd="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscsmd_v1p1"><csmd:curriculumStandardsMetadata><csmd:setOfGUIDs><csmd:labelledGUID><csmd:GUID>g</csmd:GUID></csmd:labelledGUID></csmd:setOfGUIDs></csmd:curriculumStandardsMetadata></csmd:curriculumStandardsMetadataSet>
      <lom:lom><lom:general><lom:title><lom:string>T</lom:string></lom:title></lom:general></lom:lom></metadata>`;
    const manifest = readManifest(manifestXml(resources(), { metadata }));
    expect(manifest.metadata.curriculumStandards?.standards[0]?.guidSets[0]?.labelledGuids[0]?.guid).toBe("g");
    expect(manifest.metadata.lom?.name).toBe("lom");
  });

  it("[K2] rejects a manifest without metadata, without a schema or a version, and with another element in the metadata", () => {
    expect(
      issueCode(() =>
        readManifest(`<manifest xmlns="${CP_NAMESPACE}" identifier="m"><organizations/>${resources()}</manifest>`),
      ),
    ).toBe("olah/package/missing-element");
    expect(
      issueCode(() =>
        readManifest(
          manifestXml(resources(), { metadata: "<metadata><schemaversion>3.0.0</schemaversion></metadata>" }),
        ),
      ),
    ).toBe("olah/package/missing-element");
    expect(
      issueCode(() =>
        readManifest(manifestXml(resources(), { metadata: "<metadata><schema>QTI Package</schema></metadata>" })),
      ),
    ).toBe("olah/package/missing-element");
    expect(
      issueCode(() =>
        readManifest(manifestXml(resources(), { metadata: `${SCHEMA.replace("</metadata>", "<other/></metadata>")}` })),
      ),
    ).toBe("olah/package/unexpected-element");
    expect(
      issueCode(() =>
        readManifest(
          manifestXml(resources(), { metadata: SCHEMA.replace("</metadata>", "<lom:lom/><lom:lom/></metadata>") }),
        ),
      ),
    ).toBe("olah/package/unexpected-element");
  });

  it("[K3] reads an empty organizations element and a manifest without one", () => {
    expect(readManifest(manifestXml(resources(), { organizations: "<organizations/>" })).resources).toEqual([]);
    expect(readManifest(manifestXml(resources(), { organizations: "" })).resources).toEqual([]);
  });

  it("[K3][B89] rejects organizations with an organization or an item, and a nested manifest", () => {
    for (const organizations of [
      "<organizations><organization identifier='o'/></organizations>",
      "<organizations><item identifier='i'/></organizations>",
    ]) {
      expect(issueCode(() => readManifest(manifestXml(resources(), { organizations })))).toBe(
        "olah/package/organizations",
      );
    }
    expect(issueCode(() => readManifest(manifestXml(resources(`<manifest identifier="n"/>`))))).toBe(
      "olah/package/unexpected-element",
    );
    expect(issueCode(() => readManifest(minimal.replace("</manifest>", '<manifest identifier="n"/></manifest>')))).toBe(
      "olah/package/unexpected-element",
    );
  });

  it("[K10][K11][K12][K13][K14][K15][K16][K17][K18][K19][K20][K21][K22][K23][K24][K25][K26][K27][K28] accepts each of the 19 resource types and no other", () => {
    expect(RESOURCE_TYPES).toHaveLength(19);
    for (const type of RESOURCE_TYPES) {
      const manifest = readManifest(manifestXml(resources(resourceXml("a", type, "a.xml"))));
      expect(manifest.resources[0]?.type, type).toBe(type);
    }
    for (const type of ["imsqti_item_xmlv3p0 ", "IMSQTI_ITEM_XMLV3P0", "imsqti_item_xmlv2p1", "item", ""]) {
      expect(
        issueCode(() => readManifest(manifestXml(resources(resourceXml("a", type, "a.xml"))))),
        type,
      ).toBe("olah/package/invalid-attribute");
    }
  });

  it("[K20][G12] reads the type imslti_xmlv1p1 of BIND §8.8, which the 1EdTech examples use, as imsbasiclti_xmlv1p3", () => {
    const manifest = readManifest(manifestXml(resources(resourceXml("a", "imslti_xmlv1p1", "links/a.xml"))));
    expect(manifest.resources[0]?.type).toBe("imsbasiclti_xmlv1p3");
  });

  it("[K5] requires an identifier and a type, makes the href optional, and rejects an attribute the schema does not declare", () => {
    expect(
      issueCode(() =>
        readManifest(manifestXml('<resources><resource type="webcontent"><file href="a"/></resource></resources>')),
      ),
    ).toBe("olah/package/missing-attribute");
    expect(
      issueCode(() =>
        readManifest(manifestXml('<resources><resource identifier="a"><file href="a"/></resource></resources>')),
      ),
    ).toBe("olah/package/missing-attribute");
    expect(
      readManifest(
        manifestXml('<resources><resource identifier="a" type="webcontent"><file href="a"/></resource></resources>'),
      ).resources[0]?.href,
    ).toBeUndefined();
    expect(
      issueCode(() =>
        readManifest(
          manifestXml(
            '<resources><resource identifier="a" type="webcontent" other="1"><file href="a"/></resource></resources>',
          ),
        ),
      ),
    ).toBe("olah/package/unexpected-attribute");
    expect(issueCode(() => readManifest(minimal.replace('identifier="m"', 'identifier="m" other="1"')))).toBe(
      "olah/package/unexpected-attribute",
    );
    expect(issueCode(() => readManifest(minimal.replace('identifier="m"', "")))).toBe("olah/package/missing-attribute");
  });

  it("[K6][Q1][Q18][Q27] reads the metadata of a resource", () => {
    const manifest = readManifest(
      manifestXml(
        resources(
          `<resource identifier="a" type="imsqti_item_xmlv3p0" href="a.xml"><metadata><qmd:qtiMetadata><qmd:composite>false</qmd:composite></qmd:qtiMetadata><lom:lom><lom:general><lom:identifier><lom:entry>a</lom:entry></lom:identifier></lom:general></lom:lom></metadata><file href="a.xml"/></resource>`,
        ),
      ),
    );
    expect(manifest.resources[0]?.metadata?.qti).toMatchObject({ composite: false });
    expect(manifest.resources[0]?.metadata?.lom?.name).toBe("lom");
  });

  it("[K6] rejects another element in the metadata of a resource", () => {
    const xml = manifestXml(
      resources('<resource identifier="a" type="webcontent"><metadata><other/></metadata><file href="a"/></resource>'),
    );
    expect(issueCode(() => readManifest(xml))).toBe("olah/metadata/unexpected-element");
  });

  it("[K7] reads files with their metadata, requires the href, and rejects a child other than metadata", () => {
    const manifest = readManifest(
      manifestXml(
        resources(
          '<resource identifier="a" type="webcontent"><file href="a.png"><metadata><x xmlns="urn:x">1</x></metadata></file><file href="b.png"/></resource>',
        ),
      ),
    );
    expect(manifest.resources[0]?.files.map((file) => file.href)).toEqual(["a.png", "b.png"]);
    expect(manifest.resources[0]?.files[0]?.metadata?.map((element) => element.name)).toEqual(["x"]);
    expect(manifest.resources[0]?.files[1]?.metadata).toBeUndefined();
    const withFile = (file: string): string =>
      manifestXml(resources(`<resource identifier="a" type="webcontent">${file}</resource>`));
    expect(issueCode(() => readManifest(withFile("<file/>")))).toBe("olah/package/missing-attribute");
    expect(issueCode(() => readManifest(withFile('<file href="a"><other/></file>')))).toBe(
      "olah/package/unexpected-element",
    );
  });

  it("[K8] reads dependencies, and rejects a dependency without identifierref, with a child, or that names no resource", () => {
    const manifest = readManifest(
      manifestXml(
        resources(
          resourceXml("a", "webcontent", "a", '<dependency identifierref="b"/>'),
          resourceXml("b", "webcontent", "b"),
        ),
      ),
    );
    expect(manifest.resources[0]?.dependencies).toEqual(["b"]);
    const dependent = (dependency: string): string =>
      manifestXml(resources(resourceXml("a", "webcontent", "a", dependency)));
    expect(issueCode(() => readManifest(dependent("<dependency/>")))).toBe("olah/package/missing-attribute");
    expect(issueCode(() => readManifest(dependent('<dependency identifierref="a"><x/></dependency>')))).toBe(
      "olah/package/unexpected-element",
    );
    const error = thrownAs(ReadError, () =>
      readManifest(dependent('<dependency identifierref="x"/><dependency identifierref="y"/>')),
    );
    expect(error.issues.map(({ code }) => code)).toEqual([
      "olah/package/dangling-reference",
      "olah/package/dangling-reference",
    ]);
    expect(error.issues[0]).toMatchObject({ source: "BIND §8", location: { line: 1 } });
    expect(error.message).toContain("2 such problems");
  });

  it("[K1][K5][K9] rejects an identifier declared twice, among the manifest, the resources and the variants", () => {
    const duplicate = thrownAs(ReadError, () =>
      readManifest(manifestXml(resources(resourceXml("a", "webcontent", "a"), resourceXml("a", "webcontent", "b")))),
    );
    expect(duplicate.issues[0]?.code).toBe("olah/package/duplicate-identifier");
    expect(issueCode(() => readManifest(manifestXml(resources(resourceXml("m", "webcontent", "a")))))).toBe(
      "olah/package/duplicate-identifier",
    );
    const variantOfItself = `<cpx:variant identifier="a" identifierref="b"><cpx:metadata><drd:accessForAllResource/></cpx:metadata></cpx:variant>`;
    expect(
      issueCode(() =>
        readManifest(
          manifestXml(
            resources(resourceXml("a", "webcontent", "a", variantOfItself), resourceXml("b", "webcontent", "b")),
          ),
        ),
      ),
    ).toBe("olah/package/duplicate-identifier");
  });

  it("[K9][B90] reads the variants of a resource with their DRD", () => {
    const variant = `<cpx:variant identifier="v" identifierref="b"><cpx:metadata><drd:accessForAllResource><drd:hazard>flashing</drd:hazard><drd:languageOfAdaptation>id</drd:languageOfAdaptation></drd:accessForAllResource></cpx:metadata></cpx:variant>`;
    const manifest = readManifest(
      manifestXml(
        resources(
          resourceXml("a", "imsqti_item_xmlv3p0", "a.xml", variant),
          resourceXml("b", "imsqti_item_xmlv3p0", "b.xml"),
        ),
      ),
    );
    expect(manifest.resources[0]?.variants).toHaveLength(1);
    expect(manifest.resources[0]?.variants[0]).toMatchObject({
      identifier: "v",
      identifierref: "b",
      drd: { hazard: ["flashing"], languageOfAdaptation: ["id"] },
    });
  });

  it("[K9][B90] rejects a variant without metadata or an accessibility description, with a missing target, or in another namespace", () => {
    const withVariant = (variant: string): string =>
      manifestXml(resources(resourceXml("a", "webcontent", "a", variant), resourceXml("b", "webcontent", "b")));
    expect(issueCode(() => readManifest(withVariant('<cpx:variant identifier="v" identifierref="b"/>')))).toBe(
      "olah/package/missing-element",
    );
    expect(
      issueCode(() =>
        readManifest(withVariant('<cpx:variant identifier="v" identifierref="b"><cpx:metadata/></cpx:variant>')),
      ),
    ).toBe("olah/package/missing-element");
    expect(
      issueCode(() =>
        readManifest(
          withVariant(
            '<cpx:variant identifier="v" identifierref="x"><cpx:metadata><drd:accessForAllResource/></cpx:metadata></cpx:variant>',
          ),
        ),
      ),
    ).toBe("olah/package/dangling-reference");
    expect(
      issueCode(() =>
        readManifest(
          withVariant(
            '<cpx:variant identifierref="b"><cpx:metadata><drd:accessForAllResource/></cpx:metadata></cpx:variant>',
          ),
        ),
      ),
    ).toBe("olah/package/missing-attribute");
    expect(issueCode(() => readManifest(withVariant('<x:variant xmlns:x="urn:x"/>')))).toBe(
      "olah/package/unexpected-element",
    );
  });

  it("[G12] reads only the content package namespace of the QTI profile, and rejects the IMS CP 1.1 namespace that some samples use", () => {
    expect(
      issueCode(() => readManifest(minimal.replace(CP_NAMESPACE, "http://www.imsglobal.org/xsd/imscp_v1p1"))),
    ).toBe("olah/package/not-a-manifest");
    expect(issueCode(() => readManifest('<manifest identifier="m"/>'))).toBe("olah/package/not-a-manifest");
    expect(
      issueCode(() => readManifest(minimal.replace("<manifest", "<other").replace("</manifest>", "</other>"))),
    ).toBe("olah/package/not-a-manifest");
    const metadata = `<metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata>`;
    const wrongMetadata = resourceXml("a", "webcontent", "a").replace(
      "<file",
      '<metadata><q:qtiMetadata xmlns:q="http://www.imsglobal.org/xsd/qti/imsqti_asiv3p0_v1p0"/></metadata><file',
    );
    expect(issueCode(() => readManifest(manifestXml(resources(wrongMetadata), { metadata })))).toBe(
      "olah/metadata/unexpected-element",
    );
  });

  it("names the document and the position of a problem, and reports a document that is not well-formed", () => {
    const error = thrownAs(ReadError, () =>
      readManifest(minimal.replace("<schema>", "<schemas>"), { path: "pkg/imsmanifest.xml" }),
    );
    expect(error.issues[0]?.location?.path).toBe("pkg/imsmanifest.xml");
    expect(() => readManifest("<manifest")).toThrow(ReadError);
  });

  it("throws a DataError for an argument of another type, a SecurityError for a DOCTYPE and for a document above a limit", () => {
    for (const input of ["null", "3", "[]", '{"kind":"text"}'])
      expect(() => readManifest(JSON.parse(input)), input).toThrow(DataError);
    expect(() => readManifest(minimal, JSON.parse("null"))).toThrow(DataError);
    expect(() => readManifest(minimal, JSON.parse('{"limits":"x"}'))).toThrow(DataError);
    expect(securityLimit(() => readManifest(`<!DOCTYPE manifest [<!ENTITY x "y">]>${minimal}`))).toBe("doctype");
    expect(securityLimit(() => readManifest(minimal, { limits: { maxNodes: 5 } }))).toBe("maxNodes");
  });
});

describe("writeManifest", () => {
  const manifest = readManifest(
    manifestXml(
      resources(
        `<resource identifier="a" type="imsqti_item_xmlv3p0" href="a.xml" xml:base="x/"><metadata><qmd:qtiMetadata><qmd:composite>true</qmd:composite></qmd:qtiMetadata></metadata><file href="a.xml"/><dependency identifierref="b"/><cpx:variant identifier="v" identifierref="b"><cpx:metadata><drd:accessForAllResource><drd:hazard>sound</drd:hazard></drd:accessForAllResource></cpx:metadata></cpx:variant></resource>`,
        resourceXml("b", "webcontent", "b.png"),
      ),
      { root: 'xml:base="p/"' },
    ),
  );

  it("[K1][K2][K3][K4][K5][K6][K7][K8][K9] writes the structure of the CP schema, with the namespaces declared on the root", () => {
    const text = writeManifest(manifest);
    const root = parseXml(text);
    expect(root).toMatchObject({ namespace: CP_NAMESPACE, name: "manifest" });
    expect(text).toContain("<organizations/>");
    expect(text).toContain(`xmlns:qmd="${QTI_METADATA_NAMESPACE}"`);
    expect(text.match(/xmlns:qmd=/g)).toHaveLength(1);
    expect(text).toContain('xml:base="p/"');
    expect(bare(readManifest(text))).toEqual(bare(manifest));
  });

  it("[K1][K2][K4][K5][K6][K7][K8][K9] reads back what it writes, for any manifest", () => {
    fc.assert(
      fc.property(manifests, (model) => {
        expect(bare(readManifest(writeManifest(model)))).toEqual(bare(model));
      }),
      { numRuns: 150 },
    );
  });

  it("[K2] writes the schema version 3.0.0 and a manifest without resources", () => {
    const text = writeManifest({ identifier: "m", metadata: { schema: "QTI Item Bank" }, resources: [] });
    expect(text).toContain("<schema>QTI Item Bank</schema><schemaversion>3.0.0</schemaversion>");
  });

  it("[K1][K5][K7][K8][K9] throws a DataError for a manifest that would not be valid", () => {
    const base: Manifest = { identifier: "m", metadata: { schema: "QTI Package" }, resources: [] };
    const resource: Resource = {
      identifier: "a",
      type: "webcontent",
      files: [{ href: "a" }],
      dependencies: [],
      variants: [],
    };
    const cases: readonly [string, unknown][] = [
      ["an identifier with a colon", { ...base, identifier: "a:b" }],
      ["an identifier that starts with a digit", { ...base, identifier: "1a" }],
      ["a schema outside its vocabulary", { ...base, metadata: { schema: "QTI" } }],
      ["a resource type outside its vocabulary", { ...base, resources: [{ ...resource, type: "other" }] }],
      ["a resource without a file", { ...base, resources: [{ ...resource, files: [] }] }],
      ["a duplicate identifier", { ...base, resources: [resource, resource] }],
      ["the identifier of the manifest used by a resource", { ...base, resources: [{ ...resource, identifier: "m" }] }],
      ["a dangling dependency", { ...base, resources: [{ ...resource, dependencies: ["x"] }] }],
      [
        "a dangling variant",
        {
          ...base,
          resources: [
            {
              ...resource,
              variants: [
                { identifier: "v", identifierref: "x", drd: JSON.parse(JSON.stringify(readManifestVariant())) },
              ],
            },
          ],
        },
      ],
      [
        "a variant identifier used twice",
        { ...base, resources: [{ ...resource, variants: [variantTo("a", "v"), variantTo("a", "v")] }] },
      ],
      ["a href that is not a string", { ...base, resources: [{ ...resource, href: 3 }] }],
      [
        "a lom that is not a lom element",
        {
          ...base,
          metadata: {
            schema: "QTI Package",
            lom: { kind: "element", namespace: "", name: "lom", attributes: [], children: [] },
          },
        },
      ],
      ["resources that are not an array", { ...base, resources: "x" }],
      ["a null resource", { ...base, resources: [null] }],
      ["metadata that is not an object", { ...base, metadata: null }],
      ["a base that is not a string", { ...base, base: 3 }],
      ["a manifest that is null", null],
      ["a manifest that is a string", "x"],
    ];
    for (const [name, model] of cases)
      expect(() => writeManifest(JSON.parse(JSON.stringify(model))), name).toThrow(DataError);
  });
});

function readManifestVariant(): unknown {
  return variantTo("a", "v").drd;
}

function variantTo(
  target: string,
  identifier: string,
): { identifier: string; identifierref: string; drd: Resource["variants"][number]["drd"] } {
  const manifest = readManifest(
    manifestXml(
      resources(
        resourceXml(
          "a",
          "webcontent",
          "a",
          `<cpx:variant identifier="${identifier}" identifierref="a"><cpx:metadata><drd:accessForAllResource/></cpx:metadata></cpx:variant>`,
        ),
      ),
    ),
  );
  const variant = manifest.resources[0]?.variants[0];
  if (variant === undefined) throw new Error("No variant.");
  return { ...variant, identifierref: target };
}

describe("QtiPackage.resolve", () => {
  const pkg = packageOf(manifestXml(resources(resourceXml("a", "webcontent", "a.txt"))), { "a.txt": "a" });
  const resolve = (base: string, href: string): string | undefined => pkg.resolve(base, href);

  // RFC 3986 §5.4.1 resolves references against the base http://a/b/c/d;p?q; on package paths the base is b/c/d;p, and a
  // result above the root of the package is outside it (RFC 3986 would clamp it at the root).
  it("[B93] resolves the normal examples of RFC 3986 §5.4.1 against the referencing file", () => {
    const examples: readonly (readonly [string, string])[] = [
      ["g", "b/c/g"],
      ["./g", "b/c/g"],
      ["g/", "b/c/g/"],
      ["../g", "b/g"],
      ["..", "b/"],
      ["../", "b/"],
      ["../g", "b/g"],
      ["../..", ""],
      ["../../", ""],
      ["../../g", "g"],
      [";x", "b/c/;x"],
      ["g;x", "b/c/g;x"],
      ["", "b/c/d;p"],
      [".", "b/c/"],
      ["./", "b/c/"],
      ["g?y", "b/c/g"],
      ["g#s", "b/c/g"],
      ["?y", "b/c/d;p"],
      ["#s", "b/c/d;p"],
      ["./g/.", "b/c/g/"],
      ["g/./h", "b/c/g/h"],
      ["g/../h", "b/c/h"],
      ["g;x=1/./y", "b/c/g;x=1/y"],
      ["g;x=1/../y", "b/c/y"],
    ];
    for (const [reference, expected] of examples) expect(resolve("b/c/d;p", reference), reference).toBe(expected);
  });

  it("[B93] resolves against the directory that an xml:base names, and from the root", () => {
    expect(resolve("items/", "a.xml")).toBe("items/a.xml");
    expect(resolve("items/sub/", "../b.xml")).toBe("items/b.xml");
    expect(resolve("", "a/b.xml")).toBe("a/b.xml");
    expect(resolve("imsmanifest.xml", "items/a.xml")).toBe("items/a.xml");
    expect(resolve("items/a.xml", "../media/x.png")).toBe("media/x.png");
  });

  it("[B93] decodes percent-encoded octets and keeps other characters", () => {
    expect(resolve("", "my%20file.png")).toBe("my file.png");
    expect(resolve("", "%C3%BCn%C3%AF.txt")).toBe("ünï.txt");
    expect(resolve("", "ünï/a b.txt")).toBe("ünï/a b.txt");
    expect(resolve("", "%41.xml")).toBe("A.xml");
  });

  it("[B93][B94] reports a reference outside the package as undefined", () => {
    const outside = [
      "../x.xml",
      "a/../../x.xml",
      "/abs.xml",
      "//host/x.xml",
      "http://example.com/x.xml",
      "https://example.com/x.xml",
      "file:///etc/passwd",
      "data:text/plain,hi",
      "mailto:a@b.c",
      "C:/x.xml",
      "C:\\x.xml",
      "a\\b.xml",
      "a/b\\..\\..\\c.xml",
      "a\u0000b.xml",
      "a\u001fb.xml",
      "a\u007fb.xml",
      "%2e%2e/x.xml",
      "%2E%2E%2Fx.xml",
      "a%2Fb.xml",
      "a%5Cb.xml",
      "%00",
      "%zz",
      "%4",
      "%ff",
      "%C3",
    ];
    for (const href of outside) expect(resolve("", href), JSON.stringify(href)).toBeUndefined();
    expect(resolve("items/", "../../x.xml")).toBeUndefined();
    expect(resolve("items/a.xml", "../../x.xml")).toBeUndefined();
  });

  it("[B93][B94] resolves a reference that contains a colon in a segment after a slash as a path", () => {
    expect(resolve("", "items/a:b.xml")).toBe("items/a:b.xml");
  });

  it("[B93] throws a DataError when an argument is not a string", () => {
    expect(() => pkg.resolve(JSON.parse("null"), "a")).toThrow(DataError);
    expect(() => pkg.resolve("", JSON.parse("3"))).toThrow(DataError);
  });

  it("[B93][P] gives a normalized path that stays inside the package, for any base and reference", () => {
    const paths = (segments: readonly string[]): fc.Arbitrary<string> =>
      fc.array(fc.constantFrom(...segments), { maxLength: 5 }).map((chosen) => chosen.join("/"));
    fc.assert(
      fc.property(
        paths(["a", "b", "..", ".", "", "c d", "é"]),
        paths(["a", "..", ".", "", "c d", "%2e%2e", "%C3%A9"]),
        (base, reference) => {
          const resolved = resolve(base, reference);
          if (resolved === undefined) return;
          const segments = resolved.split("/").filter((part) => part !== "");
          expect(segments.some((part) => part === ".." || part === ".")).toBe(false);
          expect(resolved.startsWith("/")).toBe(false);
          expect(resolve("", resolved)).toBe(resolved);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("resourcePath", () => {
  const manifest = readManifest(
    manifestXml(
      `<resources xml:base="items/"><resource identifier="a" type="imsqti_item_xmlv3p0" href="a.xml" xml:base="sub/"><file href="a.xml"/><file href="../b.png"/></resource><resource identifier="b" type="webcontent" xml:base="/abs/"><file href="x"/></resource><resource identifier="c" type="webcontent"><file href="x"/></resource></resources>`,
      { root: 'xml:base="pkg/"' },
    ),
  );
  const [a, b, c] = manifest.resources;

  it("[B93][K1][K4][K5] resolves an href against the xml:base of the manifest, the resources and the resource, each against the one before", () => {
    expect(resourcePath(manifest, a as Resource)).toBe("pkg/items/sub/a.xml");
    expect(resourcePath(manifest, a as Resource, "../b.png")).toBe("pkg/items/b.png");
    expect(resourcePath(manifest, c as Resource, "x")).toBe("pkg/items/x");
  });

  it("[B93] returns undefined for a resource without an href and for a base outside the package", () => {
    expect(resourcePath(manifest, c as Resource)).toBeUndefined();
    expect(resourcePath(manifest, b as Resource, "x")).toBeUndefined();
  });

  it("[B93] resolves against the root when no xml:base is given", () => {
    const plain = readManifest(manifestXml(resources(resourceXml("a", "webcontent", "x/a.png"))));
    expect(resourcePath(plain, plain.resources[0] as Resource)).toBe("x/a.png");
  });

  it("throws a DataError for an argument of another type", () => {
    expect(() => resourcePath(JSON.parse("null"), a as Resource)).toThrow(DataError);
    expect(() => resourcePath(manifest, JSON.parse("null"))).toThrow(DataError);
    expect(() => resourcePath(manifest, a as Resource, JSON.parse("3"))).toThrow(DataError);
  });
});

/** Files in memory for `openPackage`, which count how often a file is read. */
function memoryFiles(files: Readonly<Record<string, string>>): PackageFiles & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    paths: Object.keys(files),
    read: (path) => {
      reads.push(path);
      const text = files[path];
      return text === undefined ? undefined : bytes(text);
    },
  };
}

describe("openPackage", () => {
  const manifest = manifestXml(resources(resourceXml("a", "imsqti_item_xmlv3p0", "items/a.xml")));

  it("[K5] reads only the manifest when it opens, and each document once when it is asked for", () => {
    const files = memoryFiles({ "imsmanifest.xml": manifest, "items/a.xml": item("a") });
    const pkg = openPackage(files);
    expect(files.reads).toEqual(["imsmanifest.xml"]);
    expect(pkg.paths).toEqual(["imsmanifest.xml", "items/a.xml"]);
    expect(pkg.document("items/a.xml")).toMatchObject({ kind: "item", item: { identifier: "a" } });
    expect(pkg.document("items/a.xml")).toBe(pkg.document("items/a.xml"));
    expect(files.reads).toEqual(["imsmanifest.xml", "items/a.xml"]);
  });

  it("[K5] returns the bytes of a file, and undefined for a path the package does not list", () => {
    const pkg = openPackage(memoryFiles({ "imsmanifest.xml": manifest, "a.txt": "hello" }));
    expect(pkg.file("a.txt")).toEqual(bytes("hello"));
    expect(pkg.file("b.txt")).toBeUndefined();
    expect(pkg.file("../a.txt")).toBeUndefined();
  });

  it("[B60][B93] resolves an xi:include against the including document, inside the package", () => {
    const pkg = openPackage(
      memoryFiles({
        "imsmanifest.xml": manifest,
        "items/a.xml": item("a", '<xi:include href="fragments/f.xml"/>'),
        "items/fragments/f.xml": `<qti-item-body xmlns="${ASI}"/>`,
      }),
    );
    expect(pkg.document("items/a.xml").kind).toBe("item");
  });

  it("[B60][B94] rejects an xi:include that names a file outside the package, even with a fallback", () => {
    const files = (href: string): PackageFiles =>
      memoryFiles({
        "imsmanifest.xml": manifest,
        "items/a.xml": item("a", `<xi:include href="${href}"><xi:fallback><qti-item-body/></xi:fallback></xi:include>`),
      });
    for (const href of ["../../x.xml", "http://example.com/x.xml", "/etc/passwd", "..\\x.xml"]) {
      expect(
        securityLimit(() => openPackage(files(href)).document("items/a.xml")),
        href,
      ).toBe("path");
    }
  });

  it("[B60] uses the fallback of an xi:include whose target is missing, and fails without one", () => {
    const pkg = openPackage(
      memoryFiles({
        "imsmanifest.xml": manifest,
        "items/a.xml": item(
          "a",
          '<xi:include href="missing.xml"><xi:fallback><qti-item-body/></xi:fallback></xi:include>',
        ),
        "items/b.xml": item("b", '<xi:include href="missing.xml"/>'),
      }),
    );
    expect(pkg.document("items/a.xml").kind).toBe("item");
    expect(issueCode(() => pkg.document("items/b.xml"))).toBe("olah/xml/xinclude-resource");
  });

  it("[B60] rejects an xi:include with an xpointer and a loop of includes", () => {
    const pkg = openPackage(
      memoryFiles({
        "imsmanifest.xml": manifest,
        "items/a.xml": item("a", '<xi:include href="b.xml" xpointer="x"/>'),
        "items/c.xml": item("c", '<xi:include href="d.xml"/>'),
        "items/d.xml": `<x xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="d.xml"/></x>`,
      }),
    );
    expect(issueCode(() => pkg.document("items/a.xml"))).toBe("olah/xml/xinclude-attribute");
    expect(issueCode(() => pkg.document("items/c.xml"))).toBe("olah/xml/xinclude-cycle");
  });

  it("applies the xml limits to the manifest and the documents", () => {
    const files = memoryFiles({ "imsmanifest.xml": manifest, "items/a.xml": item("a") });
    expect(securityLimit(() => openPackage(files, { xmlLimits: { maxNodes: 5 } }))).toBe("maxNodes");
    const pkg = openPackage(files, { xmlLimits: { maxNodes: 100 } });
    expect(pkg.manifest.identifier).toBe("m");
    expect(securityLimit(() => openPackage(files, { xmlLimits: { maxBytes: 100 } }))).toBe("maxBytes");
  });

  it("[K5] rejects a package without a manifest, and a document that is missing or is not an ASI document", () => {
    expect(issueCode(() => openPackage(memoryFiles({ "a.txt": "x" })))).toBe("olah/package/no-manifest");
    const pkg = openPackage(memoryFiles({ "imsmanifest.xml": manifest, "items/a.xml": "<x/>" }));
    expect(issueCode(() => pkg.document("items/missing.xml"))).toBe("olah/package/missing-file");
    expect(issueCode(() => pkg.document("items/a.xml"))).toBe("olah/asi/document-element");
  });

  it("throws a DataError for files that are not normalized or not unique, and for arguments of another type", () => {
    const valid = { "imsmanifest.xml": manifest };
    const base = memoryFiles(valid);
    for (const paths of [
      ["imsmanifest.xml", "a/../b"],
      ["imsmanifest.xml", "/b"],
      ["imsmanifest.xml", "imsmanifest.xml"],
      ["imsmanifest.xml", "a\\b"],
      ["imsmanifest.xml", 3],
    ]) {
      expect(() => openPackage({ ...base, paths: JSON.parse(JSON.stringify(paths)) }), JSON.stringify(paths)).toThrow(
        DataError,
      );
    }
    for (const files of ["null", '"x"', '{"paths":"x","read":null}', '{"paths":[]}'])
      expect(() => openPackage(JSON.parse(files)), files).toThrow(DataError);
    expect(() => openPackage(base, JSON.parse("null"))).toThrow(DataError);
    expect(() => openPackage(base, JSON.parse('{"xmlLimits":null}'))).toThrow(DataError);
    const pkg = openPackage(base);
    expect(() => pkg.file(JSON.parse("3"))).toThrow(DataError);
    expect(() => pkg.document(JSON.parse("null"))).toThrow(DataError);
  });
});

describe("readPackage", () => {
  it("[K30] reads the archives that Python's zipfile writes: stored and deflated entries, UTF-8 names, directories, data descriptors", () => {
    for (const name of ["valid.zip", "streamed.zip"]) {
      const pkg = readPackage(fixture(name));
      const expected = expectations[name] ?? [];
      expect(pkg.paths, name).toEqual(expected.map((entry) => entry.name));
      for (const { name: path, size, sha256: hash } of expected) {
        const data = pkg.file(path);
        expect(data?.length, `${name} ${path}`).toBe(size);
        expect(sha256(data ?? new Uint8Array()), `${name} ${path}`).toBe(hash);
      }
    }
  });

  it("[K30] reads an archive with ZIP64 records: the end record markers, the 64-bit directory and the 64-bit extra fields", () => {
    const pkg = readPackage(fixture("zip64.zip"));
    const expected = expectations["zip64.zip"] ?? [];
    expect(pkg.paths).toEqual(expected.map((entry) => entry.name));
    for (const { name, sha256: hash } of expected) expect(sha256(pkg.file(name) ?? new Uint8Array()), name).toBe(hash);
    expect(pkg.manifest.identifier).toBe("fixture");
  });

  it("[K30] leaves directory entries out of the paths and returns bytes the caller may change", () => {
    const pkg = readPackage(fixture("valid.zip"));
    expect(pkg.paths.some((path) => path.endsWith("/"))).toBe(false);
    const first = pkg.file("media/noise.bin");
    first?.fill(0);
    expect(pkg.file("media/noise.bin")?.some((byte) => byte !== 0)).toBe(true);
  });

  it("[K30] reads an archive with a comment, and one made of entries with a data descriptor and stored data", () => {
    const manifest = bytes(manifestXml(resources()));
    const zip = buildZip([{ name: "imsmanifest.xml", data: manifest, method: 0 }]);
    const withComment = concat([zip.subarray(0, zip.length - 2), new Uint8Array([5, 0]), bytes("hello")]);
    expect(readPackage(withComment).manifest.identifier).toBe("m");
  });

  it("[K30][B94] normalizes entry names inside the package and keeps the path as written otherwise", () => {
    const manifest = bytes(manifestXml(resources()));
    const zip = buildZip([
      { name: "./imsmanifest.xml", data: manifest },
      { name: "a/../b.xml", data: bytes("<b/>") },
      { name: "dir/", data: new Uint8Array(), method: 0 },
      { name: "./", data: new Uint8Array(), method: 0 },
    ]);
    expect(readPackage(zip).paths).toEqual(["imsmanifest.xml", "b.xml"]);
  });

  it("[K30][B94] rejects an entry that leaves the package, is absolute, or has a backslash, in archives that tools write", () => {
    for (const name of ["zip-slip.zip", "absolute.zip", "backslash.zip"]) {
      expect(
        securityLimit(() => readPackage(fixture(name))),
        name,
      ).toBe("path");
    }
  });

  it("[K30][B94] rejects names with a drive letter, a control character, a NUL, a parent segment above the root, and a directory that leaves the package", () => {
    const manifest = { name: "imsmanifest.xml", data: bytes(manifestXml(resources())) } satisfies RawEntry;
    const names = [
      "C:/x.xml",
      "C:x.xml",
      "a\u0000b.xml",
      "a\nb.xml",
      "a/../../b.xml",
      "..",
      "/",
      "../dir/",
      "x/../../dir/",
      "a\\b/",
    ];
    for (const name of names) {
      expect(
        securityLimit(() => readPackage(buildZip([manifest, { name, data: bytes("x"), method: 0 }]))),
        JSON.stringify(name),
      ).toBe("path");
    }
  });

  it("[K30][B94] rejects two entries whose names are equal after normalization", () => {
    expect(securityLimit(() => readPackage(fixture("duplicate.zip")))).toBe("duplicate-path");
  });

  it("[K30][B94] rejects a symbolic link that a Unix tool writes, and ignores the mode of an entry from another system", () => {
    expect(securityLimit(() => readPackage(fixture("symlink.zip")))).toBe("symlink");
    const manifest = { name: "imsmanifest.xml", data: bytes(manifestXml(resources())) } satisfies RawEntry;
    const link = (host: number): Uint8Array =>
      buildZip([manifest, { name: "l", data: bytes("x"), host, externalAttributes: 0o120777 * 65536 }]);
    expect(securityLimit(() => readPackage(link(3)))).toBe("symlink");
    expect(securityLimit(() => readPackage(link(19)))).toBe("symlink");
    expect(readPackage(link(0)).paths).toEqual(["imsmanifest.xml", "l"]);
    const regular = buildZip([
      manifest,
      { name: "f", data: bytes("x"), host: 3, externalAttributes: 0o100644 * 65536 },
    ]);
    expect(readPackage(regular).paths).toEqual(["imsmanifest.xml", "f"]);
  });

  it("[K30][B94] rejects an encrypted entry", () => {
    const manifest = { name: "imsmanifest.xml", data: bytes(manifestXml(resources())) } satisfies RawEntry;
    for (const flags of [0x1, 0x40, 0x2000, 0x801]) {
      expect(
        securityLimit(() => readPackage(buildZip([manifest, { name: "s", data: bytes("x"), flags }]))),
        String(flags),
      ).toBe("encrypted");
    }
  });

  it("[K30][B94] rejects a zip bomb by its ratio, and by its size when the ratio is allowed", () => {
    const bomb = fixture("bomb.zip");
    expect(securityLimit(() => readPackage(bomb))).toBe("maxRatio");
    expect(securityLimit(() => readPackage(bomb, { limits: { maxRatio: 100_000, maxEntryBytes: 1_000_000 } }))).toBe(
      "maxEntryBytes",
    );
    expect(securityLimit(() => readPackage(bomb, { limits: { maxRatio: 100_000, maxTotalBytes: 1_000_000 } }))).toBe(
      "maxTotalBytes",
    );
    const allowed = readPackage(bomb, { limits: { maxRatio: 100_000 } });
    expect(allowed.file("zeros.bin")?.length).toBe(40_000_000);
  });

  it("[K30][B94] exempts a small entry from the ratio and counts the bytes while inflating, whatever the header says", () => {
    const manifest = { name: "imsmanifest.xml", data: bytes(manifestXml(resources())) } satisfies RawEntry;
    const small = readPackage(buildZip([manifest, { name: "z", data: new Uint8Array(100_000) }]));
    expect(small.file("z")?.length).toBe(100_000);
    const lying = readPackage(buildZip([manifest, { name: "z", data: new Uint8Array(1_000_000), declaredSize: 100 }]));
    expect(securityLimit(() => lying.file("z"))).toBe("declaredBytes");
    const tiny = readPackage(
      buildZip([manifest, { name: "z", data: new Uint8Array(1_000_000), declaredSize: 1, crc: 0 }]),
    );
    expect(securityLimit(() => tiny.file("z"))).toBe("declaredBytes");
  });

  it("[K30][B94] rejects an archive with more entries than maxEntries, before it reads the directory", () => {
    const manifest = { name: "imsmanifest.xml", data: bytes(manifestXml(resources())) } satisfies RawEntry;
    const zip = buildZip([manifest, { name: "a", data: bytes("x") }, { name: "b", data: bytes("x") }]);
    expect(securityLimit(() => readPackage(zip, { limits: { maxEntries: 2 } }))).toBe("maxEntries");
    expect(readPackage(zip, { limits: { maxEntries: 3 } }).paths).toHaveLength(3);
    const claims = buildZip([manifest], { declaredCount: 60_000 });
    expect(securityLimit(() => readPackage(claims, { limits: { maxEntries: 1000 } }))).toBe("maxEntries");
  });

  it("[K30][B94] counts directory entries against maxEntries and the sizes of all files against maxTotalBytes", () => {
    const manifest = { name: "imsmanifest.xml", data: bytes(manifestXml(resources())) } satisfies RawEntry;
    const zip = buildZip([manifest, { name: "d/", method: 0 }, { name: "e/", method: 0 }]);
    expect(securityLimit(() => readPackage(zip, { limits: { maxEntries: 2 } }))).toBe("maxEntries");
    const big = buildZip([
      manifest,
      { name: "a", data: new Uint8Array(600) },
      { name: "b", data: new Uint8Array(600) },
    ]);
    expect(securityLimit(() => readPackage(big, { limits: { maxTotalBytes: 1000 } }))).toBe("maxTotalBytes");
  });

  it("[K30] rejects data that is not an archive, an archive that is cut off, and records that do not agree", () => {
    const manifest = { name: "imsmanifest.xml", data: bytes(manifestXml(resources())) } satisfies RawEntry;
    const zip = buildZip([manifest, { name: "a.txt", data: bytes("hello hello hello") }]);
    expect(issueCode(() => readPackage(new Uint8Array()))).toBe("olah/package/zip");
    expect(issueCode(() => readPackage(bytes("not a zip archive at all, but long enough to hold an end record")))).toBe(
      "olah/package/zip",
    );
    expect(issueCode(() => readPackage(zip.subarray(0, zip.length - 10)))).toBe("olah/package/zip");
    expect(issueCode(() => readPackage(zip.subarray(0, 40)))).toBe("olah/package/zip");
    expect(issueCode(() => readPackage(buildZip([manifest], { disk: 1 })))).toBe("olah/package/zip");
    expect(issueCode(() => readPackage(buildZip([manifest], { declaredCount: 3 })))).toBe("olah/package/zip");
    expect(issueCode(() => readPackage(buildZip([{ ...manifest, method: 12 }])))).toBe("olah/package/zip");
    expect(issueCode(() => readPackage(buildZip([{ ...manifest, method: 0, declaredCompressedSize: 5 }])))).toBe(
      "olah/package/zip",
    );
  });

  it("[K30] reports corrupt data when a file is read: a wrong CRC, wrong size, bad deflate data, a local header that disagrees, a cut-off entry", () => {
    const manifest = { name: "imsmanifest.xml", data: bytes(manifestXml(resources())) } satisfies RawEntry;
    const read = (entry: RawEntry): Uint8Array | undefined => readPackage(buildZip([manifest, entry])).file("f");
    const data = bytes("hello hello hello");
    expect(issueCode(() => read({ name: "f", data, crc: 1 }))).toBe("olah/package/zip");
    expect(issueCode(() => read({ name: "f", data, method: 0, declaredSize: 5, declaredCompressedSize: 5 }))).toBe(
      "olah/package/zip",
    );
    expect(issueCode(() => read({ name: "f", data, declaredSize: 50 }))).toBe("olah/package/zip");
    expect(issueCode(() => read({ name: "f", data, stored: new Uint8Array([0xff, 0xff, 0xff, 0xff]) }))).toBe(
      "olah/package/zip",
    );
    expect(issueCode(() => read({ name: "f", data, localName: "g" }))).toBe("olah/package/zip");
    expect(issueCode(() => read({ name: "f", data, declaredCompressedSize: 5000 }))).toBe("olah/package/zip");
    expect(read({ name: "f", data })).toEqual(data);
  });

  it("[K30] throws a DataError for an archive of another type and for options of another type", () => {
    for (const zip of ["null", '"x"', "[1]", "{}"]) expect(() => readPackage(JSON.parse(zip)), zip).toThrow(DataError);
    const zip = fixture("valid.zip");
    expect(() => readPackage(zip, JSON.parse("null"))).toThrow(DataError);
    expect(() => readPackage(zip, JSON.parse('{"limits":null}'))).toThrow(DataError);
    expect(() => readPackage(zip, JSON.parse('{"limits":{"maxEntries":0}}'))).toThrow(
      /maxEntries must be a positive integer/,
    );
    expect(() => readPackage(zip, JSON.parse('{"limits":{"maxRatio":"2"}}'))).toThrow(DataError);
    expect(() => readPackage(zip, JSON.parse('{"xmlLimits":null}'))).toThrow(DataError);
  });
});

describe("DEFAULT_ZIP_LIMITS", () => {
  it("[K30] is about 1,000 times the entries of the largest example, 100 times its largest entry, 200 times its size and 9 times its ratio", () => {
    // The largest 1EdTech example package has 99 entries, an entry of 5,251,725 bytes, 11,018,253 bytes and a ratio of 27.9.
    expect(DEFAULT_ZIP_LIMITS).toEqual({
      maxEntries: 100_000,
      maxEntryBytes: 536_870_912,
      maxTotalBytes: 2_147_483_648,
      maxRatio: 250,
    });
  });
});

describe("packageResolvers", () => {
  const drd = (inner: string): string =>
    `<cpx:metadata><drd:accessForAllResource>${inner}</drd:accessForAllResource></cpx:metadata>`;
  const link = (identifier: string, to: string, inner: string): string =>
    `<cpx:variant identifier="${identifier}" identifierref="${to}">${drd(inner)}</cpx:variant>`;
  const manifest = manifestXml(
    resources(
      resourceXml(
        "core",
        "imsqti_item_xmlv3p0",
        "items/core.xml",
        `${link("v1", "plain", "<drd:hazard>flashing</drd:hazard><drd:hazard>ext:x</drd:hazard>")}${link("v2", "tool", "<drd:languageOfAdaptation>id</drd:languageOfAdaptation>")}`,
      ),
      resourceXml(
        "plain",
        "imsqti_item_xmlv3p0",
        "items/plain.xml",
        link("v3", "plain2", "<drd:hazard>sound</drd:hazard>"),
      ),
      resourceXml(
        "plain2",
        "imsqti_item_xmlv3p0",
        "items/plain2.xml",
        link("v4", "plain", "<drd:hazard>sound</drd:hazard><drd:hazard>flashing</drd:hazard>"),
      ),
      resourceXml("tool", "imslti_xmlv1p1", "links/tool.xml"),
      resourceXml("passage", "imsqti_stimulus_xmlv3p0", "passages/s.xml"),
      resourceXml("sec", "imsqti_section_xmlv3p0", "sections/s.xml"),
      resourceXml("test", "imsqti_test_xmlv3p0", "tests/t.xml"),
      resourceXml("img", "webcontent", "media/x.png"),
      '<resource identifier="headless" type="imsqti_item_xmlv3p0"><file href="items/headless.xml"/></resource>',
      resourceXml("outside", "imsqti_item_xmlv3p0", "../out.xml"),
    ),
  );
  const toolLink = lti("<blti:title>Tool</blti:title><blti:launch_url>https://tool.example/launch</blti:launch_url>");
  const pkg = packageOf(manifest, {
    "items/core.xml": item("core"),
    "items/plain.xml": item("plain"),
    "items/plain2.xml": item("plain2"),
    "links/tool.xml": toolLink,
    "passages/s.xml": `<qti-assessment-stimulus xmlns="${ASI}" identifier="passage" title="s"><qti-stimulus-body/></qti-assessment-stimulus>`,
    "sections/s.xml": `<qti-assessment-section xmlns="${ASI}" identifier="sec" title="s" visible="true"/>`,
    "tests/t.xml": `<qti-assessment-test xmlns="${ASI}" identifier="test" title="t"/>`,
    "media/x.png": "png",
    "items/headless.xml": item("headless"),
  });
  const resolvers = packageResolvers(pkg);

  it("[B90][K9] resolves an item reference to the item, its variants and the DRD of the links to them", () => {
    const resolved = resolvers.items("../items/core.xml", "tests/t.xml");
    expect(resolved.resource).toBe("core");
    expect(resolved.deliverable).toMatchObject({ kind: "qti", item: { identifier: "core" } });
    expect(resolved.hazards).toEqual([]);
    expect(resolved.variants.map(({ resource }) => resource)).toEqual(["plain", "tool"]);
    expect(resolved.variants[0]).toMatchObject({
      deliverable: { kind: "qti", item: { identifier: "plain" } },
      drd: { hazard: ["flashing", "ext:x"] },
    });
    expect(resolved.variants[1]).toMatchObject({
      deliverable: {
        kind: "lti",
        identifier: "tool",
        link: { title: "Tool", launchUrl: "https://tool.example/launch" },
      },
      drd: { languageOfAdaptation: ["id"] },
    });
  });

  it("[B90][K9] gives an item the hazards of the DRD of the variant links that point at it, once each and without extension terms", () => {
    expect(resolvers.items("items/plain.xml", "").hazards).toEqual(["flashing", "sound"]);
    expect(resolvers.items("items/plain2.xml", "").hazards).toEqual(["sound"]);
    expect(resolvers.items("items/plain2.xml", "").variants.map(({ resource }) => resource)).toEqual(["plain"]);
  });

  it("[K20][K9] resolves an item reference to an LTI link as an LTI deliverable", () => {
    const resolved = resolvers.items("../links/tool.xml", "tests/t.xml");
    expect(resolved).toMatchObject({ resource: "tool", deliverable: { kind: "lti", identifier: "tool" } });
  });

  it("[B62] resolves a stimulus reference to the stimulus and a section reference to the section", () => {
    expect(resolvers.stimuli("../passages/s.xml", "items/core.xml")).toMatchObject({ identifier: "passage" });
    expect(resolvers.sections("../sections/s.xml", "tests/t.xml")).toMatchObject({ identifier: "sec" });
  });

  it("[B93][B94] reports a reference outside the package, to no item resource, to a missing file or to a document of another kind", () => {
    expect(issueCode(() => resolvers.items("../../x.xml", "tests/t.xml"))).toBe("olah/package/outside-package");
    expect(issueCode(() => resolvers.items("http://example.com/x.xml", "tests/t.xml"))).toBe(
      "olah/package/outside-package",
    );
    expect(issueCode(() => resolvers.items("items/other.xml", "tests/t.xml"))).toBe("olah/package/unknown-resource");
    expect(issueCode(() => resolvers.items("media/x.png", ""))).toBe("olah/package/unknown-resource");
    expect(issueCode(() => resolvers.items("sections/s.xml", ""))).toBe("olah/package/unknown-resource");
    expect(issueCode(() => resolvers.sections("../missing.xml", "tests/t.xml"))).toBe("olah/package/missing-file");
    expect(issueCode(() => resolvers.sections("../passages/s.xml", "tests/t.xml"))).toBe("olah/package/document-kind");
    expect(issueCode(() => resolvers.stimuli("../sections/s.xml", "tests/t.xml"))).toBe("olah/package/document-kind");
    expect(issueCode(() => resolvers.stimuli("../../x.xml", "tests/t.xml"))).toBe("olah/package/outside-package");
  });

  it("[B94] reports a variant resource that has no main file inside the package, a file of the wrong kind and a missing LTI file", () => {
    const variant = `<cpx:variant identifier="v" identifierref="headless">${drd("")}</cpx:variant>`;
    const linked = packageResolvers(
      packageOf(
        manifestXml(
          resources(
            resourceXml("i", "imsqti_item_xmlv3p0", "i.xml", variant),
            '<resource identifier="headless" type="imsqti_item_xmlv3p0"><file href="n.xml"/><file href="m.xml"/></resource>',
          ),
        ),
        { "i.xml": item("i") },
      ),
    );
    expect(issueCode(() => linked.items("i.xml", ""))).toBe("olah/package/resource-href");
    const kind = packageResolvers(
      packageOf(manifestXml(resources(resourceXml("i", "imsqti_item_xmlv3p0", "i.xml"))), {
        "i.xml": `<qti-assessment-test xmlns="${ASI}" identifier="t" title="t"/>`,
      }),
    );
    expect(issueCode(() => kind.items("i.xml", ""))).toBe("olah/package/document-kind");
    const missing = packageResolvers(
      packageOf(manifestXml(resources(resourceXml("l", "imsbasiclti_xmlv1p3", "l.xml")))),
    );
    expect(issueCode(() => missing.items("l.xml", ""))).toBe("olah/package/missing-file");
  });

  it("[B91] resolves the outcome declaration and response processing resources that items depend on through the closure", () => {
    const linked = readManifest(
      manifestXml(
        resources(
          resourceXml(
            "i",
            "imsqti_item_xmlv3p0",
            "i.xml",
            '<dependency identifierref="o"/><dependency identifierref="rp"/>',
          ),
          resourceXml("o", "imsqti_outcomes_xmlv3p0", "outcomes.xml"),
          resourceXml("rp", "imsqti_rptemplate_xmlv3p0", "rp.xml"),
        ),
      ),
    );
    expect(dependencyClosure(linked, "i").map(({ identifier, type }) => [identifier, type])).toEqual([
      ["i", "imsqti_item_xmlv3p0"],
      ["o", "imsqti_outcomes_xmlv3p0"],
      ["rp", "imsqti_rptemplate_xmlv3p0"],
    ]);
  });

  it("throws a DataError for an argument of another type", () => {
    for (const input of ["null", '"x"']) expect(() => packageResolvers(JSON.parse(input)), input).toThrow(DataError);
  });
});

describe("writePackage", () => {
  const manifest: Manifest = readManifest(manifestXml(resources(resourceXml("a", "webcontent", "a.txt"))));

  it("[K30] writes an archive that readPackage reads back: the manifest first, then the files in the order of the map", () => {
    const files = new Map([
      ["b.bin", new Uint8Array([1, 2, 3])],
      ["a/ünï.txt", bytes("hello ".repeat(100))],
      ["empty", new Uint8Array()],
    ]);
    const pkg = readPackage(writePackage(manifest, files));
    expect(pkg.paths).toEqual(["imsmanifest.xml", "b.bin", "a/ünï.txt", "empty"]);
    expect(pkg.file("b.bin")).toEqual(new Uint8Array([1, 2, 3]));
    expect(pkg.file("a/ünï.txt")).toEqual(bytes("hello ".repeat(100)));
    expect(pkg.file("empty")).toEqual(new Uint8Array());
    expect(bare(pkg.manifest)).toEqual(bare(manifest));
  });

  it("[K30] writes an archive that fflate's own reader reads, and the same bytes for the same input", () => {
    const files = new Map([
      ["a.txt", bytes("x".repeat(500))],
      ["ünï/b.bin", new Uint8Array([9, 8, 7])],
    ]);
    const zip = writePackage(manifest, files);
    expect(writePackage(manifest, files)).toEqual(zip);
    const unzipped = unzipSync(zip);
    expect(Object.keys(unzipped)).toEqual(["imsmanifest.xml", "a.txt", "ünï/b.bin"]);
    expect(unzipped["a.txt"]).toEqual(bytes("x".repeat(500)));
    expect(unzipped["ünï/b.bin"]).toEqual(new Uint8Array([9, 8, 7]));
    expect(new TextDecoder().decode(unzipped["imsmanifest.xml"])).toBe(writeManifest(manifest));
  });

  it("[K30] deflates an entry when that makes it smaller and stores it otherwise", () => {
    const text = bytes("a".repeat(1000));
    const zip = writePackage(
      manifest,
      new Map([
        ["text", text],
        ["tiny", bytes("a")],
      ]),
    );
    expect(zip.length).toBeLessThan(2000);
    const pkg = readPackage(zip);
    expect(pkg.file("text")).toEqual(text);
    expect(pkg.file("tiny")).toEqual(bytes("a"));
  });

  it("[K30] throws a DataError for a path that is not normalized, the manifest as a file, bytes of another type, and a manifest that is not valid", () => {
    const bad: readonly [string, unknown][] = [
      ["a path with ..", new Map([["../a", bytes("x")]])],
      ["an absolute path", new Map([["/a", bytes("x")]])],
      ["a path with a backslash", new Map([["a\\b", bytes("x")]])],
      ["the manifest", new Map([["imsmanifest.xml", bytes("x")]])],
      ["a path that is not normalized", new Map([["./a", bytes("x")]])],
      ["bytes that are a string", new Map([["a", "x"]])],
      ["files that are an object", { a: bytes("x") }],
      ["files that are null", null],
    ];
    for (const [name, files] of bad)
      expect(() => writePackage(manifest, files as ReadonlyMap<string, Uint8Array>), name).toThrow(DataError);
    expect(() => writePackage(JSON.parse('{"identifier":"m"}'), new Map())).toThrow(DataError);
  });

  it("[K30] throws a DataError when the archive would need ZIP64", () => {
    const files = new Map<string, Uint8Array>();
    for (let index = 0; index < 65_535; index++) files.set(`f${index}`, new Uint8Array());
    expect(() => writePackage(manifest, files)).toThrow(/needs ZIP64/);
  });
});

describe("properties", () => {
  it("[K30] readPackage reads back any set of files that writePackage writes", () => {
    const name = fc
      .array(fc.constantFrom("a", "b", "é", "c d", "1"), { minLength: 1, maxLength: 3 })
      .map((parts) => parts.join("/"));
    const files = fc.uniqueArray(fc.tuple(name, fc.uint8Array({ maxLength: 300 })), {
      selector: ([path]) => path,
      maxLength: 6,
    });
    const manifest = readManifest(manifestXml(resources()));
    fc.assert(
      fc.property(files, (entries) => {
        // A file and a directory cannot share a path in an archive of files: "a" and "a/b" are both allowed here
        // because the archive stores names, not a tree.
        const map = new Map(entries);
        const pkg = readPackage(writePackage(manifest, map));
        expect(pkg.paths).toEqual(["imsmanifest.xml", ...map.keys()]);
        for (const [path, data] of map) expect(pkg.file(path)).toEqual(data);
      }),
      { numRuns: 100 },
    );
  });

  it("[K30][B94] readPackage never throws anything but a ReadError or a SecurityError on bytes that are damaged", () => {
    const valid = fixture("valid.zip");
    fc.assert(
      fc.property(fc.nat(valid.length - 1), fc.integer({ min: 0, max: 255 }), (index, value) => {
        const damaged = valid.slice();
        damaged[index] = value;
        try {
          const pkg = readPackage(damaged);
          for (const path of pkg.paths) pkg.file(path);
        } catch (error) {
          expect(error instanceof ReadError || error instanceof SecurityError, String(error)).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });
});
