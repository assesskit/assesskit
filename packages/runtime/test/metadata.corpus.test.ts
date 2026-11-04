import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import {
  deriveQtiMetadata,
  parseXml,
  ReadError,
  readLomGeneral,
  readManifest,
  readPackage,
  readResourceMetadata,
  resolveResourcePath,
  type XmlElement,
} from "../src/index.js";

const examples = join(requireCorpus(resolve(import.meta.dirname, "../../..")), "qti-examples/qtiv3-examples");
const packaging = join(examples, "packaging");

const bytes = (path: string): Uint8Array => new Uint8Array(readFileSync(join(packaging, path)));
const manifest = (path: string): ReturnType<typeof readManifest> => readManifest(bytes(path), { path });
const categories = (lom: XmlElement | undefined): string[] =>
  (lom?.children ?? []).flatMap((child) => (child.kind === "element" ? [child.name] : []));

describe("the metadata of the 1EdTech examples", () => {
  const choice = manifest("metaData/imsmanifest.xml").resources[0]?.metadata;

  it("has the QTI metadata that the metaData manifest spells", () => {
    expect(choice?.qti).toEqual({
      timeDependent: false,
      interactionTypes: ["choiceInteraction"],
      feedbackType: "nonadaptive",
      solutionAvailable: true,
      scoringModes: [],
      toolName: "XMLSPY",
      toolVersion: "5.4",
      toolVendor: "ALTOVA",
    });
  });

  it("has the identifier and the title of the general category that the metaData manifest spells", () => {
    expect(choice?.lom && readLomGeneral(choice.lom)).toEqual({
      identifiers: ["qti_v2_item_01"],
      titles: [{ language: "en", text: "Metadata Example Item #1" }],
    });
  });

  it("has the life cycle, meta-metadata and technical categories that the metaData manifest spells", () => {
    expect(categories(choice?.lom)).toEqual(["general", "lifeCycle", "metaMetadata", "technical"]);
  });

  it("has the context of a portable custom interaction in the pci manifest", () => {
    const contexts = manifest("pci/src/imsmanifest.xml")
      .resources.map((resource) => resource.metadata?.qti?.portableCustomInteractionContext)
      .filter((context) => context !== undefined);
    expect(contexts).toHaveLength(4);
    expect(contexts[0]).toEqual({
      customTypeIdentifier: "urn:fdc:hmhco.com:2019:pci:tapToReveal",
      interactionKind: "selection",
    });
    expect(contexts[1]).toEqual({
      customTypeIdentifier: "urn:fdc:hmhco.com:2019:pci:shading",
      interactionKind: "selection",
    });
  });

  it("has the curriculum standards that the CASE manifest spells", () => {
    const standards = manifest("CASE/imsmanifest.xml").resources.flatMap(
      (resource) => resource.metadata?.curriculumStandards?.standards ?? [],
    );
    expect(standards.length).toBeGreaterThan(0);
    const guid = standards[0]?.guidSets[0]?.labelledGuids[0];
    expect(guid).toEqual({
      label: "order a set of rational numbers arising from mathematical and real-world contexts; and",
      caseItemUri: "https://teks-api.texasgateway.org/ims/case/v1p0/CFItems/6abfaa45-644b-52e8-891e-4fa4045a6c69",
      guid: "6abfaa45-644b-52e8-891e-4fa4045a6c69",
    });
  });

  it("has external metadata files with the QTI metadata, the LOM and the standards that they spell", () => {
    const external = readResourceMetadata(
      parseXml(bytes("externalMetadata/testitems/metadata_747eee11-848c-597a-8c9c-a71c5399798d.xml"), {
        path: "metadata.xml",
      }),
    );
    expect(external.qti).toEqual({
      itemTemplate: false,
      composite: false,
      interactionTypes: ["choiceInteraction"],
      feedbackType: "nonadaptive",
      scoringModes: [],
    });
    expect(external.curriculumStandards?.standards[0]?.guidSets[0]?.labelledGuids[0]).toEqual({
      label: "identify a number, its opposite, and its absolute value;",
      caseItemUri: "https://teks-api.texasgateway.org/ims/case/v1p0/CFItems/747eee11-848c-597a-8c9c-a71c5399798d",
      guid: "747eee11-848c-597a-8c9c-a71c5399798d",
    });
    expect(categories(external.lom)).toEqual(["educational", "lifeCycle", "classification"]);
  });

  it("reads the metadata of every resource of every manifest and every external metadata file", () => {
    let withQti = 0;
    let spelled = 0;
    for (const path of readdirSync(packaging, { recursive: true, encoding: "utf8" }).filter((entry) =>
      entry.endsWith("imsmanifest.xml"),
    )) {
      const read = manifest(path);
      spelled +=
        Buffer.from(bytes(path))
          .toString("utf8")
          .match(/<(?:\w+:)?qtiMetadata>/g)?.length ?? 0;
      for (const resource of read.resources) if (resource.metadata?.qti !== undefined) withQti++;
      for (const resource of read.resources.filter(({ type }) => type === "resourcemetadata/xml")) {
        const file = resource.files[0]?.href ?? "";
        expect(readResourceMetadata(parseXml(bytes(join(path, "..", file)))).qti, file).toBeDefined();
      }
    }
    expect(withQti).toBe(spelled);
    expect(withQti).toBeGreaterThan(30);
  });
});

describe("the metadata that the example items show", () => {
  /** The fields that an author spelled in the manifest and that `deriveQtiMetadata` derives, as `field: spelled > derived`, by package and resource. */
  function differences(): string[] {
    const found: string[] = [];
    const unreadable: string[] = [];
    let compared = 0;
    for (const path of readdirSync(packaging, { recursive: true, encoding: "utf8" }).filter((entry) =>
      entry.endsWith(".zip"),
    )) {
      let pkg: ReturnType<typeof readPackage>;
      try {
        pkg = readPackage(bytes(path));
      } catch {
        continue;
      }
      for (const resource of pkg.manifest.resources) {
        const spelled = resource.metadata?.qti;
        let document: ReturnType<typeof pkg.document> | undefined;
        try {
          document =
            spelled && resource.type === "imsqti_item_xmlv3p0"
              ? pkg.document(resolveResourcePath(pkg.manifest, resource) ?? "")
              : undefined;
        } catch (error) {
          if (!(error instanceof ReadError)) throw error;
          unreadable.push(`${path} ${resource.identifier}`);
        }
        if (spelled === undefined || document?.kind !== "item") continue;
        compared++;
        const derived = deriveQtiMetadata(document.item);
        for (const field of [
          "itemTemplate",
          "timeDependent",
          "composite",
          "feedbackType",
          "solutionAvailable",
        ] as const) {
          if (spelled[field] !== undefined && spelled[field] !== derived[field]) {
            found.push(`${path} ${resource.identifier} ${field}: ${spelled[field]} > ${derived[field]}`);
          }
        }
        const types = (list: readonly string[]): string => [...list].sort().join(",");
        if (
          spelled.interactionTypes.length > 0 &&
          types(spelled.interactionTypes) !== types(derived.interactionTypes)
        ) {
          found.push(
            `${path} ${resource.identifier} interactionTypes: ${types(spelled.interactionTypes)} > ${types(derived.interactionTypes)}`,
          );
        }
        if (spelled.scoringModes.length > 0 && spelled.scoringModes.join() !== derived.scoringModes.join()) {
          found.push(
            `${path} ${resource.identifier} scoringModes: ${spelled.scoringModes.join()} > ${derived.scoringModes.join()}`,
          );
        }
      }
    }
    // The item has an attribute that the ASI schema does not have, `fallback-configuration`, so that the reader refuses it.
    expect(unreadable).toEqual(["pci/pci_item_examples.zip fractions-primary-configuration"]);
    expect(compared).toBe(31);
    return found.sort();
  }

  it("agree with the metadata of the manifests in 31 items, except where an author's metadata differs from the item", () => {
    // Each line is an item whose manifest says otherwise than the item shows: the manifest says nonadaptive for items without
    // feedback (CASE, metaData), extendedText for items with a text entry (ccPackage), no solution for items that declare
    // correct responses (hotspot-maximum, the pci fractions), and a solution for an item that declares correct responses for
    // one of its two responses (adaptiveTemplate).
    expect(differences()).toEqual(
      [
        "CASE/CASE.zip res_-TX_G06SAMP_001 feedbackType: nonadaptive > none",
        "CASE/CASE.zip res_-TX_G06SAMP_004 feedbackType: nonadaptive > none",
        "CASE/CASE.zip res_-TX_G06SAMP_005 feedbackType: nonadaptive > none",
        "BBQsTest/BBQsTest.zip hotspot-maximum solutionAvailable: false > true",
        "ccPackage/ccPackage.zip QUE_102011 interactionTypes: extendedTextInteraction > textEntryInteraction",
        "ccPackage/ccPackage.zip QUE_102015 interactionTypes: extendedTextInteraction > textEntryInteraction",
        "maxfiles/maxfiles.zip adaptiveTemplate solutionAvailable: true > false",
        "metaData/metaData.zip choice feedbackType: nonadaptive > none",
        "pci/pci_item_examples.zip fractions-dependencies-module-path solutionAvailable: false > true",
        "pci/pci_item_examples.zip fractions-no-dependencies solutionAvailable: false > true",
        "test_package_minfiles/test_package_minfiles.zip adaptiveTemplate solutionAvailable: true > false",
      ].sort(),
    );
  });

  it("derive the metadata that the metaData manifest spells for its choice item, except the feedback it does not have", () => {
    const pkg = readPackage(bytes("metaData/metaData.zip"));
    const document = pkg.document("choice.xml");
    if (document.kind !== "item") throw new Error("Not an item.");
    expect(deriveQtiMetadata(document.item)).toMatchObject({
      timeDependent: false,
      interactionTypes: ["choiceInteraction"],
      solutionAvailable: true,
      scoringModes: ["responseprocessing"],
    });
  });
});
