import type {
  AssessmentItemRef,
  AssessmentSection,
  AssessmentSectionRef,
  AssessmentTest,
  TestPart,
} from "../asi/index.js";
import { checkSynchronous, describe } from "../checks.js";
import { type Resolvers, resolveReference } from "../package/index.js";
import { failureIssues } from "./failures.js";
import type { Findings } from "./findings.js";

/** An item reference placed in the test, with the document that holds it. */
export interface PlacedItemRef {
  readonly kind: "item-ref";
  readonly model: AssessmentItemRef;
  /** The path of the document that holds the reference, against which its `href` resolves. */
  readonly base: string;
  readonly parent: PlacedSection;
  /** The position in presentation order, counted over every part, section and item reference. */
  readonly order: number;
  /** The position of the last node below this one; equal to `order`. */
  readonly last: number;
}

/** A section placed in the test, in the test document or in the document a section reference names. */
export interface PlacedSection {
  readonly kind: "section";
  readonly model: AssessmentSection;
  readonly base: string;
  readonly parent: PlacedPart | PlacedSection;
  readonly children: (PlacedSection | PlacedItemRef)[];
  readonly order: number;
  last: number;
}

/** A test part placed in the test. */
export interface PlacedPart {
  readonly kind: "part";
  readonly model: TestPart;
  readonly sections: PlacedSection[];
  readonly order: number;
  last: number;
}

/** A node of the placed structure. */
export type Placed = PlacedPart | PlacedSection | PlacedItemRef;

/** Returns the test part that holds a node. */
export function partOf(node: Placed): PlacedPart {
  let at: Placed = node;
  while (at.kind !== "part") at = at.parent;
  return at;
}

/** Returns whether a node may be presented several times, because a section above it selects with replacement (INFO §5.98). */
export function mayRepeat(node: Placed): boolean {
  if (node.kind === "part") return false;
  for (let at: Placed = node.parent; at.kind !== "part"; at = at.parent) {
    if (at.model.selection?.withReplacement === true) return true;
  }
  return false;
}

/**
 * Returns whether `ITEM.VAR`, with no instance number, names no value for an item reference: selection with replacement
 * can repeat it and its test part submits each item alone. In a part that submits simultaneously the value is that of the
 * instance submitted last (INFO §2.11.1.2, G9).
 */
export function hasUndefinedInstance(node: PlacedItemRef): boolean {
  return mayRepeat(node) && partOf(node).model.submissionMode !== "simultaneous";
}

/** The test with its section references resolved, and the section documents it read. */
export interface PlacedTest {
  readonly parts: readonly PlacedPart[];
  /** The part, section or item reference with each identifier; the first wins when an identifier repeats. */
  readonly byIdentifier: ReadonlyMap<string, Placed>;
  /** The item references in presentation order. */
  readonly itemRefs: readonly PlacedItemRef[];
  /** The sections read through a section reference, with the path of their documents. */
  readonly sectionDocuments: readonly { readonly path: string; readonly section: AssessmentSection }[];
  /** Whether every section reference was resolved, so that the structure is all there is. */
  readonly complete: boolean;
}

/** Builds the placed structure of a test, reporting what it finds wrong with the identifiers and the references. */
class Builder {
  private readonly resolvers: Pick<Resolvers, "sections"> | undefined;
  private readonly findings: Findings;
  private complete = true;
  private readonly byIdentifier = new Map<string, Placed>();
  private readonly itemRefs: PlacedItemRef[] = [];
  private readonly sectionDocuments: { path: string; section: AssessmentSection }[] = [];
  private counter = 0;

  constructor(resolvers: Pick<Resolvers, "sections"> | undefined, findings: Findings) {
    this.resolvers = resolvers;
    this.findings = findings;
  }

  build(test: AssessmentTest, base: string): PlacedTest {
    const parts = test.testParts.map((model) => {
      const part: PlacedPart = { kind: "part", model, sections: [], order: this.counter++, last: 0 };
      this.claim(model.identifier, part, "a test part", "qti-test-part");
      for (const child of model.sections) {
        const section = this.section(child, base, part);
        if (section !== undefined) part.sections.push(section);
      }
      part.last = this.counter - 1;
      return part;
    });
    return {
      parts,
      byIdentifier: this.byIdentifier,
      itemRefs: this.itemRefs,
      sectionDocuments: this.sectionDocuments,
      complete: this.complete,
    };
  }

  /** Parts, sections and item references share one set of identifiers (INFO §4.2.1, §5.6, §5.159.1). */
  private claim(identifier: string, node: Placed, what: string, element: string): void {
    const earlier = this.byIdentifier.get(identifier);
    if (earlier === undefined) {
      this.byIdentifier.set(identifier, node);
      return;
    }
    const kinds = { part: "a test part", section: "a section", "item-ref": "an item reference" };
    const message = `The identifier ${describe(identifier)} names ${kinds[earlier.kind]} and ${what}; the identifiers of test parts, sections and item references must be unique in a test.`;
    this.findings.error(
      "assesskit/validate/duplicate-identifier",
      message,
      "INFO §4.2.1, §5.159.1",
      `qti-assessment-test/${element}`,
    );
  }

  private section(
    child: AssessmentSection | AssessmentSectionRef,
    base: string,
    parent: PlacedPart | PlacedSection,
  ): PlacedSection | undefined {
    const resolved =
      child.kind === "assessment-section-ref" ? this.reference(child, base) : { model: child, holder: base };
    if (resolved === undefined) return undefined;
    const { model, holder } = resolved;
    const section: PlacedSection = {
      kind: "section",
      model,
      base: holder,
      parent,
      children: [],
      order: this.counter++,
      last: 0,
    };
    this.claim(model.identifier, section, "a section", "qti-assessment-section");
    for (const member of model.children) {
      if (member.kind === "assessment-item-ref") {
        const ref: PlacedItemRef = {
          kind: "item-ref",
          model: member,
          base: holder,
          parent: section,
          order: this.counter,
          last: this.counter,
        };
        this.counter += 1;
        this.claim(member.identifier, ref, "an item reference", "qti-assessment-item-ref");
        this.itemRefs.push(ref);
        section.children.push(ref);
      } else if (member.kind === "assessment-section" || member.kind === "assessment-section-ref") {
        const nested = this.section(member, holder, section);
        if (nested !== undefined) section.children.push(nested);
      }
    }
    section.last = this.counter - 1;
    return section;
  }

  /** Resolves a `qti-assessment-section-ref` to its section and the path of that document (INFO §7.5, BIND §8.2). */
  private reference(ref: AssessmentSectionRef, base: string): { model: AssessmentSection; holder: string } | undefined {
    this.complete = this.resolvers !== undefined && this.complete;
    if (this.resolvers === undefined) return undefined;
    const path = resolveReference(base, ref.href);
    let model: AssessmentSection;
    try {
      model = this.resolvers.sections(ref.href, base);
    } catch (error) {
      this.complete = false;
      this.findings.adopt(failureIssues(error, base));
      return undefined;
    }
    // Outside the try: a promise is a defect of the host and not a finding.
    checkSynchronous(model, "The resolver sections");
    if (model.identifier !== ref.identifier) {
      const message = `The section reference ${describe(ref.identifier)} names ${describe(ref.href)}, whose section has the identifier ${describe(model.identifier)}; the two must be equal.`;
      this.findings.error(
        "assesskit/validate/identifier-mismatch",
        message,
        "INFO §7.5",
        "qti-assessment-test/qti-assessment-section-ref",
      );
    }
    const holder = path ?? base;
    this.sectionDocuments.push({ path: holder, section: model });
    return { model, holder };
  }
}

/**
 * Places the parts, sections and item references of a test in presentation order, resolving the section references. The
 * resolver is called once for each reference; item references stay unresolved. A section whose document cannot be read is
 * reported and left out.
 *
 * @param test - The test.
 * @param base - The path of the test document, against which its references resolve.
 * @param resolvers - Only `sections` is called; absent when the test is checked alone, so that section references stay
 * unresolved without a report.
 * @param findings - Where the problems go: an identifier that repeats, and a reference that cannot be resolved.
 */
export function placeTest(
  test: AssessmentTest,
  base: string,
  resolvers: Pick<Resolvers, "sections"> | undefined,
  findings: Findings,
): PlacedTest {
  return new Builder(resolvers, findings).build(test, base);
}
