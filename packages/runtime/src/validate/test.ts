import { type AssessmentItem, type AssessmentStimulus, type AssessmentTest, walkDocument } from "../asi/index.js";
import { checkSynchronous } from "../checks.js";
import { type DeliverableItem, type ResolvedItem, type Resolvers, resolveReference } from "../package/index.js";
import { AttributeReferences } from "./attribute-references.js";
import { BindRuleSets } from "./bind-rule-sets.js";
import { BranchRuleChecks } from "./branch-rules.js";
import { ContentReferences } from "./content-references.js";
import { checkCovers } from "./covers.js";
import { checkDeclarations } from "./declarations.js";
import { DocumentChecks } from "./document-checks.js";
import { ExpressionChecker } from "./expressions.js";
import { failureIssues } from "./failures.js";
import type { Findings } from "./findings.js";
import { FormatChecks } from "./formats.js";
import { checkElements } from "./generic-checks.js";
import { checkItem } from "./item.js";
import { itemVariables } from "./item-scope.js";
import type { CheckedOptions } from "./options.js";
import type { Reports } from "./reports.js";
import { RuleChecker } from "./rules.js";
import { describeStatic, fitsVariable, typeOfVariable } from "./static-type.js";
import { type ItemRefInfo, TEST_BUILT_IN, TestScope } from "./test-scope.js";
import {
  hasUndefinedInstance,
  type Placed,
  type PlacedItemRef,
  type PlacedSection,
  type PlacedTest,
  placeTest,
} from "./test-structure.js";
import { checkTestStructure } from "./test-structure-checks.js";

const ROOT = "qti-assessment-test";

/** The resolvers of a test and the path of its document, which are given when the items it names are to be checked. */
export interface TestResolution {
  /** The path of the test document, against which its references resolve. */
  readonly base: string;
  /** The resolvers of the references of the test. */
  readonly resolvers: Resolvers;
}

/** What resolving the item references of a test found. */
interface ResolvedItems {
  /** The item reference with its item, where the reference could be resolved, by the identifier of the item reference. */
  readonly refs: ReadonlyMap<string, ItemRefInfo>;
  /** Each item to check once, with the path of its document. */
  readonly items: readonly { readonly path: string | undefined; readonly item: AssessmentItem }[];
}

/** Returns the item a deliverable presents, `undefined` for a link to a tool or no deliverable. */
function qtiItemOf(deliverable: DeliverableItem | undefined): AssessmentItem | undefined {
  return deliverable?.kind === "qti" ? deliverable.item : undefined;
}

/** Resolves the item references of a placed test, each document once, and reports the references that cannot be resolved. */
function resolveItems(placed: PlacedTest, resolvers: Resolvers, reports: Reports): ResolvedItems {
  const byPath = new Map<string, ResolvedItem | undefined>();
  const refs = new Map<string, ItemRefInfo>();
  const items = new Map<AssessmentItem, string | undefined>();
  const add = (item: AssessmentItem | undefined, path: string | undefined): void => {
    if (item !== undefined && !items.has(item)) items.set(item, path);
  };
  for (const node of placed.itemRefs) {
    const { model, base } = node;
    const path = resolveReference(base, model.href) ?? model.href;
    if (!byPath.has(path)) byPath.set(path, resolveItem(resolvers, model.href, base, reports));
    const resolved = byPath.get(path);
    const item = qtiItemOf(resolved?.deliverable);
    if (!refs.has(model.identifier))
      refs.set(model.identifier, {
        ref: model,
        undefinedInstance: hasUndefinedInstance(node),
        ...(item === undefined ? {} : { item }),
      });
    add(item, path);
    // The engine may present a variant instead of the item, so a variant is as reachable as the item.
    for (const variant of resolved?.variants ?? []) add(qtiItemOf(variant.deliverable), undefined);
  }
  return { refs, items: [...items].map(([item, path]) => ({ item, path })) };
}

/** Resolves one item reference; a reference that cannot be resolved is reported and gives `undefined`. */
function resolveItem(resolvers: Resolvers, href: string, base: string, reports: Reports): ResolvedItem | undefined {
  let resolved: ResolvedItem;
  try {
    resolved = resolvers.items(href, base);
  } catch (error) {
    reports.of(base).adopt(failureIssues(error, base));
    return undefined;
  }
  // Outside the try: a promise is a defect of the host and not a finding.
  checkSynchronous(resolved, "The resolver items");
  return resolved;
}

/**
 * Warns when the item named by an item reference has another identifier than the reference. INFO §4.1.1 says the two must
 * be the same, and the examples of 1EdTech's own tests often differ, so content that deviates still runs.
 */
function checkIdentifiers(placed: PlacedTest, refs: ReadonlyMap<string, ItemRefInfo>, reports: Reports): void {
  for (const { model, base } of placed.itemRefs) {
    const item = refs.get(model.identifier)?.item;
    if (item === undefined || item.identifier === model.identifier) continue;
    const message = `The item reference ${JSON.stringify(model.identifier)} names an item with the identifier ${JSON.stringify(item.identifier)}; when an item is referenced the two identifiers should be the same.`;
    reports.of(base).warning("assesskit/validate/identifier-mismatch", message, `${ROOT}/qti-assessment-item-ref`);
  }
}

/** Checks what an item reference says about the variables of its item: the variable mappings and the template defaults. */
function checkItemRef(
  node: PlacedItemRef,
  info: ItemRefInfo | undefined,
  rules: RuleChecker,
  findings: Findings,
): void {
  const { model } = node;
  const here = `${ROOT}/qti-assessment-item-ref`;
  const variables = info?.item === undefined ? undefined : itemVariables(info.item);
  const targets = new Set<string>();
  for (const mapping of model.variableMappings) {
    if (targets.has(mapping.targetIdentifier)) {
      const message = `The item reference ${JSON.stringify(model.identifier)} maps two variables to ${JSON.stringify(mapping.targetIdentifier)}; the target of a variable mapping must be unique.`;
      findings.error("assesskit/validate/duplicate-identifier", message, `${here}/qti-variable-mapping`);
    }
    targets.add(mapping.targetIdentifier);
    if (variables !== undefined && !variables.has(mapping.sourceIdentifier)) {
      const message = `The item reference ${JSON.stringify(model.identifier)} maps the variable ${JSON.stringify(mapping.sourceIdentifier)}, which its item declares no variable for.`;
      findings.error("assesskit/validate/undeclared-variable", message, `${here}/qti-variable-mapping`);
    }
  }
  for (const given of model.templateDefaults) {
    const at = `${here}/qti-template-default`;
    const value = rules.expressionType(given.expression, at);
    const declaration = info?.item?.templateDeclarations.find(
      ({ identifier }) => identifier === given.templateIdentifier,
    );
    if (info?.item !== undefined && declaration === undefined) {
      const message = `The item reference ${JSON.stringify(model.identifier)} sets the default of ${JSON.stringify(given.templateIdentifier)}, which its item declares no template variable for.`;
      findings.error("assesskit/validate/undeclared-variable", message, at);
    } else if (declaration !== undefined && !fitsVariable(value, declaration)) {
      const message = `The template variable ${JSON.stringify(given.templateIdentifier)} is ${describeStatic(typeOfVariable(declaration))} and cannot be given the default ${describeStatic(value)}.`;
      findings.error("assesskit/validate/assignment-type", message, at);
    }
  }
}

/** The parts, sections and item references of a placed test in presentation order, with the path of the document that holds each. */
function nodesOf(
  placed: PlacedTest,
  path: string | undefined,
): readonly { node: Placed; holder: string | undefined }[] {
  const below = (section: PlacedSection): { node: Placed; holder: string | undefined }[] => [
    { node: section, holder: section.base },
    ...section.children.flatMap((child) =>
      child.kind === "section" ? below(child) : [{ node: child, holder: section.base }],
    ),
  ];
  return placed.parts.flatMap((part) => [{ node: part, holder: path }, ...part.sections.flatMap(below)]);
}

const ELEMENTS = { part: "qti-test-part", section: "qti-assessment-section", "item-ref": "qti-assessment-item-ref" };

/** Checks the pre-conditions and branch rules of the nodes of a placed test, each in the findings of its own document. */
function checkNodeRules(
  placed: PlacedTest,
  refs: ReadonlyMap<string, ItemRefInfo>,
  rulesFor: (findings: Findings) => RuleChecker,
  reports: Reports,
  path: string | undefined,
): void {
  for (const { node, holder } of nodesOf(placed, path)) {
    const rules = rulesFor(reports.of(holder));
    const element = `${ROOT}/${ELEMENTS[node.kind]}`;
    for (const condition of node.model.preConditions) {
      rules.condition(condition.operand, "qti-pre-condition", `${element}/qti-pre-condition`);
    }
    for (const rule of node.model.branchRules) {
      rules.condition(rule.expression, "qti-branch-rule", `${element}/qti-branch-rule`);
    }
    if (node.kind === "item-ref") checkItemRef(node, refs.get(node.model.identifier), rules, reports.of(holder));
  }
}

/**
 * Runs every check on a test: the elements of its document, its declarations and outcome processing, the structure it
 * places its parts, sections and item references in, the branch rules and pre-conditions, the covers of its externally
 * scored outcomes, and, when it can resolve what the test names, the section documents and the items.
 *
 * @param test - The test.
 * @param reports - Where the issues go, by document.
 * @param options - The checked options.
 * @param resolution - The resolvers; absent when the test is checked alone, so that its section references and item
 * references stay unresolved and the checks that need what they name are left out.
 * @param checkItems - Whether to check the items the test names, which a caller that checks every item of a package
 * leaves out.
 */
export function checkTest(
  test: AssessmentTest,
  reports: Reports,
  options: CheckedOptions,
  resolution: TestResolution | undefined,
  checkItems = true,
): void {
  const path = resolution?.base ?? options.path;
  const findings = reports.of(path);
  const placed = placeTest(test, path ?? "", resolution?.resolvers, findings);
  const resolved = resolution === undefined ? undefined : resolveItems(placed, resolution.resolvers, reports);
  const containers = new Set(
    [...placed.byIdentifier].filter(([, node]) => node.kind !== "item-ref").map(([identifier]) => identifier),
  );
  const scope = new TestScope(test, resolved === undefined ? undefined : { itemRefs: resolved.refs, containers });
  const rulesFor = (target: Findings): RuleChecker =>
    new RuleChecker(target, scope, new ExpressionChecker(target, scope, options.customOperators));

  const bind = new BindRuleSets(findings, undefined);
  const formats = new FormatChecks(findings);
  const content = new ContentReferences(findings, (identifier) => scope.own(identifier), "test");
  const references = new AttributeReferences(findings, (identifier) => scope.reference(identifier), "test");
  const document = new DocumentChecks(findings);
  walkDocument({ kind: "test", test }, (visit) => {
    document.visit(visit);
    bind.visit(visit);
    formats.visit(visit);
    content.visit(visit);
    references.visit(visit);
  });
  formats.finish();
  checkDeclarations(findings, {
    owner: "test",
    trail: ROOT,
    builtIn: TEST_BUILT_IN,
    groups: [
      { element: "qti-context-declaration", declarations: test.contextDeclarations },
      { element: "qti-outcome-declaration", declarations: test.outcomeDeclarations },
    ],
  });
  rulesFor(findings).outcomeRules(test.outcomeProcessing?.rules ?? [], `${ROOT}/qti-outcome-processing`);
  checkNodeRules(placed, resolved?.refs ?? new Map(), rulesFor, reports, path);
  checkCovers(test, resolved?.refs, findings);
  if (placed.complete) {
    new BranchRuleChecks(placed, findings).check();
    const items = new Map([...(resolved?.refs ?? [])].map(([identifier, { item }]) => [identifier, item]));
    checkTestStructure(placed, items, findings);
  }
  for (const { path: sectionPath, section } of placed.sectionDocuments) {
    checkElements({ kind: "section", section }, reports.of(sectionPath));
  }
  if (resolved === undefined || resolution === undefined) return;
  checkIdentifiers(placed, resolved.refs, reports);
  if (checkItems) checkItemsAndStimuli(resolved.items, resolution.resolvers, reports, options);
}

/** Checks each item the test names, and the stimuli the items name, each document once. */
function checkItemsAndStimuli(
  items: ResolvedItems["items"],
  resolvers: Resolvers,
  reports: Reports,
  options: CheckedOptions,
): void {
  const stimuli = new Set<string>();
  for (const { path, item } of items) {
    checkItem(item, reports.of(path), options);
    for (const ref of item.stimulusRefs) {
      const stimulusPath = path === undefined ? ref.href : (resolveReference(path, ref.href) ?? ref.href);
      if (stimuli.has(stimulusPath)) continue;
      stimuli.add(stimulusPath);
      let stimulus: AssessmentStimulus;
      try {
        stimulus = resolvers.stimuli(ref.href, path ?? "");
      } catch (error) {
        reports.of(path).adopt(failureIssues(error, path));
        continue;
      }
      checkSynchronous(stimulus, "The resolver stimuli");
      checkElements({ kind: "stimulus", stimulus }, reports.of(stimulusPath));
    }
  }
}
