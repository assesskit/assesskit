import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import {
  dependencyClosure,
  type Manifest,
  packageResolvers,
  parseXml,
  type QtiPackage,
  ReadError,
  readLtiLink,
  readManifest,
  readPackage,
  resourcePath,
  writeManifest,
  writePackage,
} from "../src/index.js";
import { readPackageFile } from "../src/node/index.js";

const examples = join(requireCorpus(resolve(import.meta.dirname, "../../..")), "qti-examples/qtiv3-examples");
const all = readdirSync(examples, { recursive: true, encoding: "utf8" }).sort();
const manifests = all.filter((path) => path.endsWith("imsmanifest.xml"));
const zips = all.filter((path) => path.endsWith(".zip"));

/** The two archives whose manifest uses the namespace of IMS Content Packaging 1.1 and not the one of the QTI profile. */
const IMS_CP_ARCHIVES = ["CAT/CAT_Test01_Adaptive_EchoAdapt.zip", "PCI/sample_pci.zip"];
const profileZips = zips.filter((path) => !IMS_CP_ARCHIVES.includes(path));

/**
 * The most bytes of a file that a round trip writes. The writer deflates an entry and stores it when that is not smaller,
 * whatever its size, and a megabyte of each file takes both paths; the two videos of `items.zip`, 10 MB that no deflate
 * shrinks, would take most of the time of the test.
 */
const ROUND_TRIP_BYTES = 2 ** 20;

const sha256 = (data: Uint8Array | undefined): string =>
  createHash("sha256")
    .update(data ?? new Uint8Array())
    .digest("hex");
const read = (path: string): Uint8Array => new Uint8Array(readFileSync(join(examples, path)));
const manifestOf = (path: string): Manifest => readManifest(read(path), { path });

/** Drops positions and namespace declarations from everything in a model, so that kept XML compares. */
function bare(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, member: unknown) =>
      key === "line" || key === "column"
        ? undefined
        : key === "attributes" && Array.isArray(member)
          ? member.filter((attribute) => attribute.namespace !== "http://www.w3.org/2000/xmlns/")
          : member,
    ),
  );
}

/** The items of the example packages that the ASI schema rejects, by archive and resource: a missing `use` and an unknown attribute. */
const SCHEMA_INVALID = new Set([
  "packaging/items/items.zip data-attributes",
  "packaging/pci/pci_item_examples.zip fractions-primary-configuration",
]);

describe("the 1EdTech example packages", () => {
  it("[K1][K4][K5] include 24 manifests of the QTI profile and 26 archives, two of which use the namespace of IMS CP 1.1", () => {
    expect(manifests).toHaveLength(24);
    expect(zips).toHaveLength(26);
    for (const path of IMS_CP_ARCHIVES) {
      const error = ((): ReadError | undefined => {
        try {
          readPackage(read(path));
        } catch (caught) {
          return caught instanceof ReadError ? caught : undefined;
        }
        return undefined;
      })();
      expect(error?.issues[0]?.code, path).toBe("assesskit/package/not-a-manifest");
    }
  });

  it("[K1][K5][G12] read: every one of the 24 manifests of the QTI profile is read", () => {
    for (const path of manifests) expect(manifestOf(path).resources.length, path).toBeGreaterThan(0);
  });

  it("[K10][K12][K14][K15][K17][K19][K20][K22][K24] have the resource types that the manifests spell, counted from their text", () => {
    const counts = new Map<string, number>();
    for (const path of manifests) {
      for (const resource of manifestOf(path).resources)
        counts.set(resource.type, (counts.get(resource.type) ?? 0) + 1);
    }
    // The counts of type="..." in the manifests: grep -o 'type="[^"]*"' over the 24 files; imslti_xmlv1p1 is read as imsbasiclti_xmlv1p3.
    expect([...counts].sort()).toEqual([
      ["imsbasiclti_xmlv1p3", 4],
      ["imsqti_item_xmlv3p0", 249],
      ["imsqti_outcomes_xmlv3p0", 1],
      ["imsqti_rptemplate_xmlv3p0", 5],
      ["imsqti_stimulus_xmlv3p0", 1],
      ["imsqti_test_xmlv3p0", 12],
      ["qtiusagedata/xml", 3],
      ["resourcemetadata/xml", 2],
      ["webcontent", 9],
    ]);
  });

  it("[K1][K5][K7][K8] read back what they write, as a model and as text", () => {
    for (const path of manifests) {
      const manifest = manifestOf(path);
      const text = writeManifest(manifest);
      expect(bare(readManifest(text)), path).toEqual(bare(manifest));
      expect(writeManifest(readManifest(text)), path).toBe(text);
    }
  });

  it.for(manifests)(
    "[K30] read from the directory of %s with the files that the file system lists and their bytes",
    async (manifest) => {
      const directory = join(examples, dirname(manifest));
      const listed = readdirSync(directory, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1))
        .sort();
      const pkg = await readPackageFile(directory);
      expect([...pkg.paths].sort(), manifest).toEqual(listed);
      for (const path of listed)
        expect(sha256(pkg.file(path)), `${manifest} ${path}`).toBe(sha256(readFileSync(join(directory, path))));
    },
  );

  it.for(profileZips)("[K30] read from the archive file %s by readPackageFile", async (path) => {
    const pkg = await readPackageFile(join(examples, path));
    expect(pkg.paths, path).toEqual(readPackage(read(path)).paths);
  });

  it("[K7][B89] list files that exist in the package, except the one file that the pci example misses", () => {
    const missing: string[] = [];
    for (const path of profileZips) {
      const pkg = readPackage(read(path));
      for (const resource of pkg.manifest.resources) {
        for (const file of resource.files) {
          const target = resourcePath(pkg.manifest, resource, file.href);
          if (target === undefined || !pkg.paths.includes(target))
            missing.push(`${path} ${resource.identifier} ${file.href}`);
        }
      }
    }
    // pci_item_examples.zip lists modules/lib/raphael.js for two resources and does not contain it.
    expect(missing).toEqual([
      "packaging/pci/pci_item_examples.zip pci_module_shading_deps modules/lib/raphael.js",
      "packaging/pci/pci_item_examples.zip pci_module_shading_deps_2 modules/lib/raphael.js",
    ]);
  });

  it.for(profileZips)(
    "[K30][R] write a package from the files of %s that reads back with the same manifest and bytes",
    (path) => {
      const pkg = readPackage(read(path));
      const files = new Map(
        pkg.paths
          .filter((file) => file !== "imsmanifest.xml")
          .map((file) => [file, (pkg.file(file) ?? new Uint8Array()).subarray(0, ROUND_TRIP_BYTES)]),
      );
      const again = readPackage(writePackage(pkg.manifest, files));
      expect(bare(again.manifest), path).toEqual(bare(pkg.manifest));
      for (const [file, bytes] of files) expect(sha256(again.file(file)), `${path} ${file}`).toBe(sha256(bytes));
    },
  );

  it("[K5][K10][K12] resolve every item of every package to a document, as a QTI item or an LTI link, except the two that the schema rejects", () => {
    for (const path of profileZips) {
      const pkg = readPackage(read(path));
      const resolvers = packageResolvers(pkg);
      for (const resource of pkg.manifest.resources.filter(
        ({ type }) => type === "imsqti_item_xmlv3p0" || type === "imsbasiclti_xmlv1p3",
      )) {
        const target = resourcePath(pkg.manifest, resource, resource.href ?? resource.files[0]?.href) ?? "";
        if (SCHEMA_INVALID.has(`${path} ${resource.identifier}`)) {
          expect(() => resolvers.items(target, ""), `${path} ${resource.identifier}`).toThrow(ReadError);
          continue;
        }
        const resolved = resolvers.items(target, "");
        expect(resolved.resource, `${path} ${resource.identifier}`).toBe(resource.identifier);
        expect(resolved.deliverable.kind).toBe(resource.type === "imsqti_item_xmlv3p0" ? "qti" : "lti");
      }
      for (const resource of pkg.manifest.resources.filter(({ type }) => type === "imsqti_test_xmlv3p0")) {
        expect(pkg.document(resourcePath(pkg.manifest, resource) ?? "").kind, `${path} ${resource.identifier}`).toBe(
          "test",
        );
      }
    }
  });
});

describe("the ASI documents of the example packages", () => {
  /** The kind of document that `readAsi` makes of a resource type (K10 to K17). */
  const Kinds = new Map([
    ["imsqti_test_xmlv3p0", "test"],
    ["imsqti_item_xmlv3p0", "item"],
    ["imsqti_stimulus_xmlv3p0", "stimulus"],
    ["imsqti_outcomes_xmlv3p0", "outcome-declaration"],
    ["imsqti_rptemplate_xmlv3p0", "response-processing"],
  ]);

  it("[K10][K12][K14][K15][K17] are read by document(), with the kind that the resource type names", () => {
    const counts = new Map<string, number>();
    for (const path of profileZips) {
      const pkg = readPackage(read(path));
      for (const resource of pkg.manifest.resources) {
        const kind = Kinds.get(resource.type);
        if (kind === undefined) continue;
        const target = resourcePath(pkg.manifest, resource, resource.href ?? resource.files[0]?.href);
        if (SCHEMA_INVALID.has(`${path} ${resource.identifier}`)) {
          expect(() => pkg.document(target ?? ""), `${path} ${resource.identifier}`).toThrow(ReadError);
          continue;
        }
        expect(pkg.document(target ?? "").kind, `${path} ${resource.identifier}`).toBe(kind);
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
      }
    }
    expect([...counts].sort()).toEqual([
      ["item", 247],
      ["outcome-declaration", 1],
      ["response-processing", 5],
      ["stimulus", 1],
      ["test", 12],
    ]);
  });

  it("[B91][K14][K17] have items that depend on the outcome declaration and response processing template resources they use", () => {
    const linked = new Map<string, string[]>();
    for (const path of profileZips) {
      const pkg = readPackage(read(path));
      for (const resource of pkg.manifest.resources.filter(({ type }) => type === "imsqti_item_xmlv3p0")) {
        const types = dependencyClosure(pkg.manifest, resource.identifier)
          .slice(1)
          .map(({ type }) => type)
          .filter((type) => type === "imsqti_outcomes_xmlv3p0" || type === "imsqti_rptemplate_xmlv3p0");
        if (types.length > 0) linked.set(`${path} ${resource.identifier}`, types);
      }
    }
    expect(linked.size).toBeGreaterThan(0);
    expect([...linked.values()].flat().sort()).toContain("imsqti_rptemplate_xmlv3p0");
  });
});

describe("the LTI example packages", () => {
  const links = [
    [
      "packaging/lti/lti.zip",
      "links/streaming_video_experiment101.xml",
      "Student Edition",
      "http://localhost:8085/provider",
    ],
    [
      "packaging/testWithLti/testWithLti.zip",
      "links/Choicesingle_853928446.xml",
      "choice (single)",
      "https://localhost:8085/provider",
    ],
    [
      "packaging/testWithLti/testWithLti.zip",
      "links/item1.xml",
      "Unattended Luggage",
      "http://localhost:8085/provider",
    ],
    [
      "packaging/testWithLti/testWithLti.zip",
      "links/periodicTable.xml",
      "Student Edition",
      "https://localhost:8085/provider",
    ],
  ] as const;

  it("[K20] have link documents with the titles and launch URLs that their text gives", () => {
    for (const [archive, path, title, launch] of links) {
      const link = readLtiLink(readPackage(read(archive)).file(path) ?? new Uint8Array(), { path });
      expect(link.title, path).toBe(title);
      expect(link.launchUrl ?? link.secureLaunchUrl, path).toBe(launch);
    }
  });

  it("[K20] have the custom properties and extensions of the streaming video link", () => {
    const link = readLtiLink(
      readPackage(read("packaging/lti/lti.zip")).file("links/streaming_video_experiment101.xml") ?? new Uint8Array(),
    );
    expect(link.custom.get("video_id")).toBe("af70229b-c371-48b3-8113-9a6607992dfa");
    expect(link.custom.get("QTI_CONTEXT_environmentIdentifier")).toBe("ELA-7");
    expect(link.extensions.map(({ platform }) => platform)).toEqual(["my.lms.com", "IMSGlobal.org"]);
    expect(link.extensions[1]?.properties.get("item_state")).toBe("{}");
    expect(link.vendor).toEqual({ code: "IMSGlobal.org", name: "IMS" });
  });

  it("[K20] resolve the item references of the test to LTI deliverables and a QTI item", () => {
    const pkg = readPackage(read("packaging/testWithLti/testWithLti.zip"));
    const resolvers = packageResolvers(pkg);
    const kinds = ["links/Choicesingle_853928446.xml", "links/item1.xml", "elements.xml"].map(
      (href) => resolvers.items(href, "assessment.xml").deliverable.kind,
    );
    expect(kinds).toEqual(["lti", "lti", "qti"]);
  });
});

describe("the shared stimulus example package", () => {
  const pkg = readPackage(read("packaging/sharedStimulus/sharedStimulus.zip"));

  it("[B62][K8] has items that depend on the stimulus and name it in a stimulus reference", () => {
    for (const [item, file] of [
      ["Item1", "exemplar06.xml"],
      ["Item2", "exemplar04.xml"],
      ["Item3", "exemplar05.xml"],
    ] as const) {
      expect(dependencyClosure(pkg.manifest, item).map(({ identifier }) => identifier)).toEqual([item, "Stimulus1"]);
      const root = parseXml(pkg.file(file) ?? new Uint8Array());
      const reference = root.children.find(
        (child) => child.kind === "element" && child.name === "qti-assessment-stimulus-ref",
      );
      const href =
        reference?.kind === "element"
          ? reference.attributes.find((attribute) => attribute.name === "href")?.value
          : undefined;
      expect(href).toBe("passages/unbelievableNight.xml");
      expect(packageResolvers(pkg).stimuli(href ?? "", file).identifier).toBe(
        parseXml(pkg.file("passages/unbelievableNight.xml") ?? new Uint8Array()).attributes.find(
          (attribute) => attribute.name === "identifier",
        )?.value,
      );
    }
  });
});

describe("the closure of the example tests", () => {
  it("[K8] reaches the items of a test and what they depend on", () => {
    const pkg: QtiPackage = readPackage(read("packaging/externalMetadata/externalMetadata.zip"));
    const test = pkg.manifest.resources.find(({ type }) => type === "imsqti_test_xmlv3p0");
    const closure = dependencyClosure(pkg.manifest, test?.identifier ?? "").map(({ identifier }) => identifier);
    expect(closure).toEqual([
      "res_-TX_G06SAMP_000",
      "res_-TX_G06SAMP_001",
      "metadata_6abfaa45-644b-52e8-891e-4fa4045a6c69",
      "res_-TX_G06SAMP_004",
      "res_-TX_G06SAMP_005",
      "metadata_747eee11-848c-597a-8c9c-a71c5399798d",
    ]);
  });
});
