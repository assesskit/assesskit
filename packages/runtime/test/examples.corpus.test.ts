import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import {
  type AssessmentItem,
  type CandidateAction,
  createEngine,
  createItemVariables,
  createPackageResolvers,
  createRandom,
  type DeliveryState,
  type Engine,
  type Issue,
  listPlanItems,
  planTest,
  type QtiPackage,
  ReadError,
  resolveStructure,
  validatePackage,
} from "../src/index.js";
import { readPackageFile } from "../src/node/index.js";

const examples = join(requireCorpus(resolve(import.meta.dirname, "../../..")), "qti-examples/qtiv3-examples");
const files = readdirSync(examples, { recursive: true, encoding: "utf8" }).sort();
const archives = files.filter((path) => path.endsWith(".zip"));
const directories = files.filter((path) => path.endsWith("imsmanifest.xml")).map((path) => dirname(path));

/** The archives whose manifest is in the namespace of IMS Content Packaging 1.1, which the QTI profile does not use. */
const OTHER_NAMESPACE = ["CAT/CAT_Test01_Adaptive_EchoAdapt.zip", "PCI/sample_pci.zip"];

/** The packages with errors that are defects of the examples; the other packages have none. */
const DEFECTIVE = [
  "items/shared-vocabulary/shared-vocabulary-imsmanifest.zip",
  "packaging/basicFeedbackTest/basicFeedbackTest.zip",
  "packaging/feedbackTest/feedbackTest.zip",
  "packaging/items/items.zip",
  "packaging/maxfiles/maxfiles.zip",
  "packaging/metaData/metaData.zip",
  "packaging/pci/pci_item_examples.zip",
  "packaging/test_package_minfiles/test_package_minfiles.zip",
];

/** The tests that the engine refuses, by archive, with what its refusal says: a defect of the example, or a host duty. */
const REFUSED = new Map([
  ["packaging/BBQsTest/BBQsTest.zip", /custom-operator/],
  ["packaging/basicFeedbackTest/basicFeedbackTest.zip", /adaptive-simultaneous/],
  ["packaging/feedbackTest/feedbackTest.zip", /unknown-resource/],
  ["packaging/test_package_minfiles/test_package_minfiles.zip", /adaptive-simultaneous/],
]);

/** The documents of the package that are tests. */
const testsOf = (pkg: QtiPackage): string[] =>
  pkg.manifest.resources.flatMap(({ type, href }) =>
    type === "imsqti_test_xmlv3p0" && href !== undefined ? [href] : [],
  );

/** Plays a test to its end: each item presented gets its correct responses, and is submitted where the part allows it. */
function play(engine: Engine, items: ReadonlyMap<string, AssessmentItem>): DeliveryState {
  const started = engine.start({ seed: 1, at: 0 });
  if (!started.ok) throw new Error(started.refusal.message);
  let state = started.state;
  let at = 0;
  const apply = (action: CandidateAction): boolean => {
    at += 1000;
    const step = engine.apply(state, { ...action, at });
    if (step.ok) state = step.state;
    else expect(step.refusal.code).toBe("wrong-submission-mode");
    return step.ok;
  };
  for (let current = state.current; current !== undefined; current = state.current) {
    const item = items.get(current.ref);
    if (item !== undefined) {
      const correct = [...createItemVariables(item).correctResponses].filter(([, value]) => value !== null);
      apply({ type: "set-responses", item: current, responses: new Map(correct) });
      apply({ type: "submit", item: current });
    }
    if (!apply({ type: "move", to: "next" })) throw new Error(`The test did not move on from ${current.ref}.`);
  }
  return state;
}

describe("the 1EdTech example packages", () => {
  it("have an archive for each directory", () => {
    expect(archives.length).toBeGreaterThanOrEqual(directories.length);
  });

  it.for(directories)("%s is read from its directory", async (path) => {
    const pkg = await readPackageFile(join(examples, path));
    expect(pkg.manifest.resources.length).toBeGreaterThan(0);
  });

  it.for(OTHER_NAMESPACE)("%s is refused for the namespace of its manifest", async (path) => {
    await expect(readPackageFile(join(examples, path))).rejects.toThrow(ReadError);
  });

  it.for(archives.filter((path) => !OTHER_NAMESPACE.includes(path)))(
    "%s is read, validated, and its tests run to their end",
    async (path) => {
      const pkg = await readPackageFile(join(examples, path));
      const errors = validatePackage(pkg).filter(({ severity }: Issue) => severity === "error");
      expect(errors.length > 0, "errors").toBe(DEFECTIVE.includes(path));

      const resolvers = createPackageResolvers(pkg);
      for (const href of testsOf(pkg)) {
        const document = pkg.document(href);
        if (document.kind !== "test") throw new Error(`${href} is not a test.`);
        const refusal = REFUSED.get(path);
        if (refusal !== undefined) {
          expect(() => createEngine({ kind: "test", test: document.test, base: href, resolvers }), href).toThrow(
            refusal,
          );
          continue;
        }
        const engine = createEngine({ kind: "test", test: document.test, base: href, resolvers });
        const structure = resolveStructure(document.test, href, resolvers);
        const items = new Map<string, AssessmentItem>();
        for (const key of listPlanItems(planTest(structure, { random: createRandom(1) }))) {
          const node = structure.itemRef(key.ref);
          const resolved = node === undefined ? undefined : resolvers.items(node.model.href, node.base).deliverable;
          if (resolved?.kind === "qti") items.set(key.ref, resolved.item);
        }
        expect(play(engine, items).status, href).toBe("ended");
      }
    },
  );
});
