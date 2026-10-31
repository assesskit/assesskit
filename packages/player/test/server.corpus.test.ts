import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ASI_NAMESPACE } from "@assesskit/runtime/asi";
import { CP_NAMESPACE, LOM_NAMESPACE, QTI_METADATA_NAMESPACE } from "@assesskit/runtime/metadata";
import { readPackageFile } from "@assesskit/runtime/node";
import { openPackage, type QtiPackage, resolveReference } from "@assesskit/runtime/package";
import { RESULTS_NAMESPACE } from "@assesskit/runtime/results";
import { USAGE_NAMESPACE } from "@assesskit/runtime/usage";
import { parseXml } from "@assesskit/runtime/xml";
import { describe, expect, it } from "vitest";
import { createAssetGate } from "../src/server/index.js";
import { gateKey, memoryFileStore } from "./exam-fixture.js";

const examples = resolve(import.meta.dirname, "../../../.cache/corpus/qti-examples/qtiv3-examples");
if (!existsSync(examples)) throw new Error("The 1EdTech examples are missing: run `pnpm corpus` first.");
const all = readdirSync(examples, { recursive: true, encoding: "utf8" }).sort();

/** The two archives whose manifest uses the namespace of IMS CP 1.1 and not the one of the QTI profile. */
const IMS_CP_ARCHIVES = ["CAT/CAT_Test01_Adaptive_EchoAdapt.zip", "PCI/sample_pci.zip"];

/** The namespaces of the documents that hold keys, processing, templates, usage data and metadata. */
const QTI_DATA = new Set([
  ASI_NAMESPACE,
  CP_NAMESPACE,
  RESULTS_NAMESPACE,
  USAGE_NAMESPACE,
  QTI_METADATA_NAMESPACE,
  LOM_NAMESPACE,
  "http://www.imsglobal.org/xsd/imsqti_usagedata_v2p2",
]);

/** The attributes of the references of an adaptive section to its settings, metadata and usage data, found in the text of a document. */
const ADAPTIVE_REFERENCE = /<qti-(?:adaptive-settings|metadata|usagedata)-ref\b[^>]*\bhref="([^"]+)"/gu;

/** The extensions of the files that the gate serves: the types a browser loads for content. */
const SERVED = new Set(
  "html htm css js mjs json txt csv pls svg png jpg jpeg gif webp avif bmp ico mp3 wav ogg oga opus m4a aac flac mp4 m4v webm ogv vtt srt woff woff2 ttf otf pdf".split(
    " ",
  ),
);

const DIRECTORIES = all.filter((path) => path.endsWith("imsmanifest.xml")).map((path) => dirname(path));
const ARCHIVES = all.filter((path) => path.endsWith(".zip") && !IMS_CP_ARCHIVES.includes(path));

/** Opens a package that is a directory of the examples. */
function openDirectory(directory: string): QtiPackage {
  const root = join(examples, directory);
  const paths = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== ".DS_Store")
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(root.length + 1)
        .replaceAll("\\", "/"),
    )
    .sort();
  return openPackage({ paths, read: (path) => new Uint8Array(readFileSync(join(root, path))) });
}

/** Whether the bytes are an XML document whose root is in a namespace of QTI data, or an LTI link: what the gate must never serve. */
function isKeyDocument(bytes: Uint8Array): boolean {
  try {
    const root = parseXml(bytes, { path: "probe.xml" });
    return QTI_DATA.has(root.namespace ?? "") || root.name === "cartridge_basiclti_link";
  } catch {
    return false;
  }
}

/** The paths that the settings, metadata and usage data references of the test and section documents of a package name. */
function adaptiveFiles(pkg: QtiPackage): string[] {
  return pkg.paths
    .filter((path) => path.endsWith(".xml"))
    .flatMap((path) => {
      const text = new TextDecoder().decode(pkg.file(path));
      return [...text.matchAll(ADAPTIVE_REFERENCE)].flatMap((match) => resolveReference(path, match[1] ?? "") ?? []);
    })
    .filter((path) => pkg.paths.includes(path));
}

/** Whether a path has the extension of a file that the gate serves. */
const isAsset = (path: string): boolean => SERVED.has(path.slice(path.lastIndexOf(".") + 1).toLowerCase());

/** Serves every file of a package under a token for the whole package, and returns the status of each. */
async function statuses(pkg: QtiPackage): Promise<Map<string, number>> {
  const now = 1_700_000_000_000;
  const gate = createAssetGate({
    key: await gateKey(),
    origin: "https://assets.example",
    packages: async () => pkg,
    files: memoryFileStore(),
  });
  const base = (await gate.sign("corpus", [""], now))[""] ?? "";
  const result = new Map<string, number>();
  for (const path of pkg.paths) {
    result.set(path, (await gate.serve({ path: `${new URL(base).pathname}${path}` }, now)).status);
  }
  return result;
}

describe("the asset gate over the 1EdTech example packages", () => {
  it("[T73] has 24 directories and 24 archives of packages to serve", () => {
    expect(DIRECTORIES).toHaveLength(24);
    expect(ARCHIVES).toHaveLength(24);
  });

  const packages: readonly (readonly [string, () => Promise<QtiPackage>])[] = [
    ...DIRECTORIES.map((directory) => [directory, async () => openDirectory(directory)] as const),
    ...ARCHIVES.map((archive) => [archive, () => readPackageFile(join(examples, archive))] as const),
  ];

  for (const [name, open] of packages) {
    it(`[T73] never serves the manifest, a QTI document, an LTI link or a file that is not a web asset of ${name}, and serves its other files`, async () => {
      const pkg = await open();
      const result = await statuses(pkg);
      const adaptive = new Set(adaptiveFiles(pkg));
      for (const path of pkg.paths) {
        const bytes = pkg.file(path) ?? new Uint8Array();
        const hidden = path === "imsmanifest.xml" || adaptive.has(path) || !isAsset(path) || isKeyDocument(bytes);
        const manifestDenied = pkg.manifest.resources
          .filter(
            (resource) =>
              resource.href !== undefined &&
              ![
                "webcontent",
                "pls",
                "css2",
                "css3",
                "extension",
                "associatedcontent/learning-application-resource",
              ].includes(resource.type),
          )
          .some((resource) => resource.href === path);
        expect(result.get(path), path).toBe(hidden || manifestDenied ? 404 : 200);
      }
    });
  }
});
