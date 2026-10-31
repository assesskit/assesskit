import type {
  AssessmentItemRef,
  AssessmentSection,
  AssessmentSectionRef,
  AssessmentTest,
  TestPart,
} from "../asi/index.js";
import { checkFunction, checkRecord, checkString, checkSynchronous, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { type Resolvers, resolveReference } from "../package/index.js";

/** The test, the root of its structure. */
export interface TestNode {
  /** Tells the four kinds of node apart. */
  readonly kind: "test";
  /** The test as `readAsi` reads it. */
  readonly model: AssessmentTest;
  /** The test parts in document order. */
  readonly parts: readonly PartNode[];
}

/**
 * A test part.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export interface PartNode {
  /** Tells the four kinds of node apart. */
  readonly kind: "part";
  /** The test part. */
  readonly model: TestPart;
  /** The test. */
  readonly parent: TestNode;
  /** The sections of the part in document order, a section reference replaced by the section it names. */
  readonly sections: readonly SectionNode[];
}

/** A section, in the test document or in the document that a `qti-assessment-section-ref` names. */
export interface SectionNode {
  /** Tells the four kinds of node apart. */
  readonly kind: "section";
  /** The section. */
  readonly model: AssessmentSection;
  /** The path of the document that holds the section, against which its references resolve. */
  readonly base: string;
  /** The part or section that holds the section. */
  readonly parent: PartNode | SectionNode;
  /** The children in document order, a section reference replaced by the section it names. */
  readonly children: readonly ContentNode[];
  /**
   * Whether ordering mixes the section into the list of its parent: it is invisible, it is not kept together and not
   * fixed, and its parent shuffles or is itself mixed. Such a section has no extent of its own: its pre-conditions,
   * branch rules and time limits are not in force.
   *
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
   */
  readonly dissolved: boolean;
}

/** An item reference. */
export interface ItemRefNode {
  /** Tells the four kinds of node apart. */
  readonly kind: "item-ref";
  /** The item reference. */
  readonly model: AssessmentItemRef;
  /** The path of the document that holds the reference, against which its `href` resolves. */
  readonly base: string;
  /** The section that holds the reference. */
  readonly parent: SectionNode;
}

/** A child of a section. */
export type ContentNode = SectionNode | ItemRefNode;

/** A node of the structure of a test: the test, a part, a section or an item reference. */
export type StructureNode = TestNode | PartNode | ContentNode;

/**
 * A test with its section references resolved: every part, section and item reference with the document that holds it.
 *
 * @remarks
 * The structure is the same for every session of a test; a session adds a plan to it.
 */
export interface TestStructure {
  /** The root of the structure. */
  readonly test: TestNode;
  /** Returns the test part with the identifier, `undefined` when there is none. */
  part(identifier: string): PartNode | undefined;
  /** Returns the section with the identifier, `undefined` when there is none. */
  section(identifier: string): SectionNode | undefined;
  /** Returns the item reference with the identifier, `undefined` when there is none. */
  itemRef(identifier: string): ItemRefNode | undefined;
}

/** The kind of the model of `qti-assessment-test`. */
const TEST_KIND = "assessment-test";
/** The kind of the model of `qti-assessment-section`. */
const SECTION_KIND = "assessment-section";

/**
 * Whether a section is mixed into the list of its parent when that list is shuffled: an invisible section that is not
 * kept together. A fixed section keeps its place, so it stays a block.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function dissolves(section: AssessmentSection, parent: PartNode | SectionNode): boolean {
  const mixable = section.visible === false && section.keepTogether === false && section.fixed !== true;
  return mixable && parent.kind === "section" && (parent.model.ordering?.shuffle === true || parent.dissolved);
}

class Structure implements TestStructure {
  readonly test: TestNode;
  private readonly parts: ReadonlyMap<string, PartNode>;
  private readonly sections: ReadonlyMap<string, SectionNode>;
  private readonly itemRefs: ReadonlyMap<string, ItemRefNode>;

  constructor(
    test: TestNode,
    parts: ReadonlyMap<string, PartNode>,
    sections: ReadonlyMap<string, SectionNode>,
    itemRefs: ReadonlyMap<string, ItemRefNode>,
  ) {
    this.test = test;
    this.parts = parts;
    this.sections = sections;
    this.itemRefs = itemRefs;
  }

  part(identifier: string): PartNode | undefined {
    return this.parts.get(identifier);
  }

  section(identifier: string): SectionNode | undefined {
    return this.sections.get(identifier);
  }

  itemRef(identifier: string): ItemRefNode | undefined {
    return this.itemRefs.get(identifier);
  }
}

/** Builds a structure; one instance builds one. */
class Builder {
  private readonly resolvers: Pick<Resolvers, "sections">;
  private readonly claimed = new Map<string, string>();
  private readonly parts = new Map<string, PartNode>();
  private readonly sections = new Map<string, SectionNode>();
  private readonly itemRefs = new Map<string, ItemRefNode>();

  constructor(resolvers: Pick<Resolvers, "sections">) {
    this.resolvers = resolvers;
  }

  build(test: AssessmentTest, base: string): TestStructure {
    const parts: PartNode[] = [];
    const root: TestNode = { kind: "test", model: test, parts };
    for (const model of test.testParts) {
      this.claim(model.identifier, "a test part");
      const sections: SectionNode[] = [];
      const part: PartNode = { kind: "part", model, parent: root, sections };
      this.parts.set(model.identifier, part);
      for (const child of model.sections) sections.push(this.section(child, base, part));
      parts.push(part);
    }
    return new Structure(root, this.parts, this.sections, this.itemRefs);
  }

  /** Test parts, sections and item references share one set of identifiers. */
  private claim(identifier: string, what: string): void {
    const earlier = this.claimed.get(identifier);
    if (earlier !== undefined) {
      throw new DataError(
        `The identifier ${describe(identifier)} names ${earlier} and ${what}; the identifiers of test parts, sections and item references must be unique in a test.`,
      );
    }
    this.claimed.set(identifier, what);
  }

  private section(
    child: AssessmentSection | AssessmentSectionRef,
    base: string,
    parent: PartNode | SectionNode,
  ): SectionNode {
    const { model, holder } =
      child.kind === "assessment-section-ref" ? this.reference(child, base) : { model: child, holder: base };
    this.claim(model.identifier, "a section");
    const children: ContentNode[] = [];
    const node: SectionNode = {
      kind: "section",
      model,
      base: holder,
      parent,
      children,
      dissolved: dissolves(model, parent),
    };
    this.sections.set(model.identifier, node);
    for (const member of model.children) children.push(this.content(member, holder, node));
    return node;
  }

  private content(child: AssessmentSection["children"][number], base: string, parent: SectionNode): ContentNode {
    switch (child.kind) {
      case "assessment-item-ref": {
        this.claim(child.identifier, "an item reference");
        const node: ItemRefNode = { kind: "item-ref", model: child, base, parent };
        this.itemRefs.set(child.identifier, node);
        return node;
      }
      case "assessment-section":
      case "assessment-section-ref":
        return this.section(child, base, parent);
      default:
        throw new DataError(
          `The section ${describe(parent.model.identifier)} holds an xi:include, which must be resolved before the test is planned.`,
        );
    }
  }

  /** Resolves a `qti-assessment-section-ref` to its section and the path of that document. */
  private reference(ref: AssessmentSectionRef, base: string): { model: AssessmentSection; holder: string } {
    const model = this.resolvers.sections(ref.href, base);
    checkSynchronous(model, "The resolver sections");
    checkRecord(
      model,
      `The section that ${describe(ref.href)} names must be an object of the model of qti-assessment-section`,
    );
    if (model.kind !== SECTION_KIND) {
      throw new DataError(
        `The reference ${describe(ref.href)} must name a qti-assessment-section, found the kind ${describe(model.kind)}.`,
      );
    }
    const holder = resolveReference(base, ref.href);
    if (holder === undefined) {
      throw new DataError(`The reference ${describe(ref.href)} in ${describe(base)} is outside the package.`);
    }
    if (model.identifier !== ref.identifier) {
      throw new DataError(
        `The section reference ${describe(ref.identifier)} names ${describe(ref.href)}, whose section has the identifier ${describe(model.identifier)}; the two must be equal.`,
      );
    }
    return { model, holder };
  }
}

/**
 * Resolves the section references of a test and indexes its parts, sections and item references.
 *
 * @remarks
 * The resolver is called once for each reference; the references to items stay unresolved, because a session needs an
 * item only when it presents it. A section reference is replaced by the section it names, and the references inside
 * that section resolve against the path of its document.
 *
 * @param test - The test, as `readAsi` reads it, with its includes resolved.
 * @param base - The path of the test document, against which its references resolve.
 * @param resolvers - Only `sections` is called, as `packageResolvers` provides it.
 * @returns The structure of the test.
 * @throws `DataError` when an argument has the wrong type; when two test parts, sections or item references share an
 * identifier, which a section reference to one document from two places also does; when a section reference and the
 * section it names have different identifiers; when a section holds an `xi:include`; when a reference is outside the
 * package; or when the resolver returns a promise.
 * @throws `ReadError` from the resolver, when a reference names no section.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/bind/ | QTI 3.0 ASI XML Binding}
 */
export function resolveStructure(
  test: AssessmentTest,
  base: string,
  resolvers: Pick<Resolvers, "sections">,
): TestStructure {
  checkRecord(test, "The test must be an object of the model of qti-assessment-test");
  if (test.kind !== TEST_KIND) {
    throw new DataError(`The test must be the model of a qti-assessment-test, found the kind ${describe(test.kind)}.`);
  }
  checkString(base, "The base");
  checkRecord(resolvers, "The resolvers must be an object");
  checkFunction(resolvers.sections, "The resolvers must have a function sections of an href and a base");
  return new Builder(resolvers).build(test, base);
}

/** Returns the parent of a node, `undefined` for the test. */
function parentOf(node: StructureNode): StructureNode | undefined {
  return node.kind === "test" ? undefined : node.parent;
}

/**
 * Returns the nodes that enclose a node, outermost first: the test, the part and the sections.
 *
 * @remarks
 * A section that ordering mixes into its parent is among them, because its item session control and its identifier
 * still apply to its items.
 *
 * @param node - A node of the structure.
 * @returns The enclosing nodes, outermost first.
 */
export function ancestry(node: StructureNode): readonly StructureNode[] {
  const chain: StructureNode[] = [];
  for (let at = parentOf(node); at !== undefined; at = parentOf(at)) chain.unshift(at);
  return chain;
}

/**
 * Returns the test part that holds a section or an item reference.
 *
 * @param node - A section or an item reference of the structure.
 * @returns The part.
 */
export function partOf(node: ContentNode): PartNode {
  let at: PartNode | SectionNode = node.parent;
  while (at.kind === "section") at = at.parent;
  return at;
}
