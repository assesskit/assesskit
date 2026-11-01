import { join, resolve } from "node:path";
import { ReadError } from "@assesskit/runtime/errors";
import { readManifest } from "@assesskit/runtime/package";
import { migrateQtiResourceToQti3 } from "@longsightgroup/qti3-migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { requireCorpus } from "../../../../scripts/corpus.ts";
import { checkPackage } from "../src/check-package.ts";
import { migrateSample, withSchemaVersion } from "../src/migrate-sample.ts";
import { migrateSamples, type Outcome } from "../src/migrate-samples.ts";
import { formatReport, summarize } from "../src/report.ts";
import { readSamples, type Sample } from "../src/samples.ts";
import { withApip, withPci } from "./probes.ts";

const SAMPLES = join(requireCorpus(resolve(import.meta.dirname, "../../../..")), "qti-examples/qtiv2p2-examples/items");

let samples: readonly Sample[] = [];
let outcomes: readonly Outcome[] = [];

beforeAll(async () => {
  samples = readSamples(SAMPLES);
  outcomes = await migrateSamples(samples);
});

const sample = (identifier: string): Sample => {
  const found = samples.find((candidate) => candidate.identifier === identifier);
  if (found === undefined) throw new Error(`The examples have no item ${identifier}.`);
  return found;
};

const outcome = (identifier: string): Outcome => {
  const found = outcomes.find((candidate) => candidate.identifier === identifier);
  if (found === undefined) throw new Error(`The examples have no item ${identifier}.`);
  return found;
};

/** The identifiers of the outcomes at a stage. */
const at = (stage: Outcome["stage"]): string[] =>
  outcomes.filter((candidate) => candidate.stage === stage).map(({ identifier }) => identifier);

describe("the samples", () => {
  it("are the 57 items of the manifest, each with the files of its resource", () => {
    expect(samples).toHaveLength(57);
    expect(Object.keys(sample("choice").files).sort()).toEqual(["choice.xml", "images/sign.png"]);
    for (const { href, files } of samples) expect(Object.keys(files), href).toContain(href);
  });
});

describe("the migration of the 1EdTech examples of QTI 2.2", () => {
  it("gives a package for 21 of the 57 items and refuses the other 36, and assesskit runs 15 of the 21", () => {
    const { total, stages } = summarize(outcomes);
    expect([total, ...stages.values()]).toEqual([57, 15, 0, 6, 36]);
    expect([...stages.keys()]).toEqual(["ran", "not-running", "invalid", "refused"]);
  });

  it("refuses an item for the reasons it gives, and not one of them is a change that goes unsaid", () => {
    const refused = outcomes.filter(({ stage }) => stage === "refused");
    for (const { identifier, codes } of refused) expect(codes.length, identifier).toBeGreaterThan(0);
    const { codes } = summarize(refused);
    expect(new Map([...codes].map(([code, identifiers]) => [code, identifiers.length]))).toEqual(
      new Map([
        ["core_parse.interaction.child.unsupported", 1],
        ["qti2_adaptive_not_preserved", 8],
        ["qti2_composite_interactions_unsupported", 10],
        ["qti2_correct_response_not_preserved", 2],
        ["qti2_modal_feedback_not_preserved", 2],
        ["qti2_outcomes_not_preserved", 5],
        ["qti2_response_mapping_not_preserved", 8],
        ["qti2_response_processing_not_preserved", 9],
        ["qti2_template_not_preserved", 1],
        ["qti2_text_entry_correct_response_missing", 3],
        ["writer_diagnostics", 2],
      ]),
    );
  });

  it("answers the 11 migrated items that declare correct responses with them, and each scores above 0", () => {
    const answered = outcomes.filter((candidate) => candidate.answered);
    expect(answered).toHaveLength(11);
    for (const { identifier, score } of answered) expect(score, identifier).toBeGreaterThan(0);
    // The four that run without an answer declare no correct response.
    expect(at("ran").filter((identifier) => !outcome(identifier).answered)).toEqual([
      "extended_text",
      "extended_text_rubric",
      "nested_object",
      "upload",
    ]);
    expect(summarize(outcomes).scored).toBe(11);
  });

  it("gives six packages that assesskit finds invalid, for markup that QTI 3 does not allow", () => {
    expect(at("invalid").sort()).toEqual([
      "audio_video",
      "figures",
      "graphic_order",
      "hotspot",
      "position_object",
      "select_point",
    ]);
    expect(outcome("figures").codes).toEqual(["assesskit/asi/element"]);
    expect(outcome("audio_video").codes).toEqual(["assesskit/asi/element"]);
    // An alt attribute on object, which HTML does not define for it.
    for (const identifier of ["graphic_order", "hotspot", "position_object", "select_point"]) {
      expect(outcome(identifier).codes, identifier).toEqual(["assesskit/validate/extension-attribute"]);
    }
  });

  it("gives the same counts with the safe repair of the migrator", async () => {
    const repaired = await migrateSamples(samples, { repairPolicy: "safe" });
    expect(summarize(repaired).stages).toEqual(summarize(outcomes).stages);
  });

  it("is reported with the counts and the reason of each refusal", () => {
    const report = formatReport(summarize(outcomes));
    expect(report.split("\n").slice(0, 6)).toEqual([
      "57 items of QTI 2.2",
      "  15  ran",
      "   0  not-running",
      "   6  invalid",
      "  36  refused",
      "  11  scored above 0 with the correct responses",
    ]);
    expect(report).toContain("qti2_adaptive_not_preserved: adaptive, adaptive_template,");
  });
});

describe("the package of the migrator", () => {
  it("names the schemaversion 3.0.1, which the schema of QTI 3 packages does not allow, so assesskit refuses the manifest as written", async () => {
    const { files } = sample("choice");
    const migrated = await migrateQtiResourceToQti3({ sourcePath: "choice.xml", files });
    const manifest = migrated.entries.find(({ path }) => path === "imsmanifest.xml")?.data;
    expect(typeof manifest).toBe("string");
    const text = String(manifest);
    expect(text).toContain("<schemaversion>3.0.1</schemaversion>");
    expect(() => readManifest(text)).toThrow(ReadError);
    expect(() => readManifest(text)).toThrow(/The schemaversion of a manifest must be 3\.0\.0, found "3\.0\.1"/);
    expect(() => readManifest(withSchemaVersion(text))).not.toThrow();
  });

  it("keeps the files of the resource, the images of an item among them", async () => {
    const migration = await migrateSample(sample("choice"));
    if (!migration.ok) throw new Error("The item choice was refused.");
    expect([...migration.files.keys()].sort()).toEqual(["choice.xml", "images/sign.png", "imsmanifest.xml"]);
    expect(migration.itemHref).toBe("choice.xml");
  });

  it("runs the item that it migrated: the correct response scores 1, and the session is valid", async () => {
    const migration = await migrateSample(sample("choice"));
    if (!migration.ok) throw new Error("The item choice was refused.");
    const check = checkPackage(migration.files, migration.itemHref);
    expect(check.errors).toEqual([]);
    expect(check.run).toEqual({ ok: true, answered: true, score: 1 });
  });
});

describe("what the migrator does not cover", () => {
  it("drops the APIP accessibility block of an item without a word, because it has no code for APIP", async () => {
    const migration = await migrateSample(withApip(sample("choice")));
    if (!migration.ok) throw new Error("The item with APIP was refused.");
    expect(migration.diagnostics).toEqual([]);
    const item = new TextDecoder().decode(migration.files.get(migration.itemHref));
    expect(item).not.toMatch(/apip/i);
    // The item still runs, as the item without the accessibility information: the loss is silent.
    expect(checkPackage(migration.files, migration.itemHref).run).toEqual({ ok: true, answered: true, score: 1 });
  });

  it("refuses an item with a portable custom interaction of QTI 2.x", async () => {
    const migration = await migrateSample(withPci(sample("choice")));
    expect(migration.ok).toBe(false);
    expect([...new Set(migration.diagnostics.map(({ code }) => code))].sort()).toEqual([
      "package_item_xml_missing",
      "qti2_interaction_unsupported",
    ]);
  });
});
