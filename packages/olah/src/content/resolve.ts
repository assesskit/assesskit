import {
  type AssessmentItem,
  type AssociableHotspot,
  type BodyNode,
  type FeedbackBlock,
  type FeedbackInline,
  type Gap,
  type GapImg,
  type GapText,
  type HotspotChoice,
  type HotText,
  type HtmlElement,
  type InlineChoice,
  isBodyNode,
  isModelNode,
  type ModelNode,
  type PrintedVariable,
  type RubricBlock,
  type SimpleAssociableChoice,
  type SimpleChoice,
  type TemplateBlock,
  type TemplateInline,
  type TextNode,
} from "../asi/index.js";
import { checkArray, checkChoice, checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";
import type { Value } from "../values/index.js";
import { formatPrintedVariable } from "./printed-variable.js";
import { VIEWS, type View } from "./rubric.js";
import { substituteMath, templateText } from "./substitution.js";
import type { ContentVariables } from "./variables.js";
import { isShown } from "./visibility.js";

/** The options of {@link resolveContent}. */
export interface ResolveContentOptions {
  /** The view for which the content is resolved: a rubric block stays only when its `view` lists it. */
  readonly view: View;
}

/** The elements that a template variable shows or hides: choices, gaps, hotspots and hot texts (INFO §2.7.1), and template content. */
const TEMPLATE_CONTROLLED: ReadonlySet<string> = new Set([
  "associable-hotspot",
  "gap",
  "gap-img",
  "gap-text",
  "hotspot-choice",
  "hottext",
  "inline-choice",
  "simple-associable-choice",
  "simple-choice",
  "template-block",
  "template-inline",
]);

type TemplateControlled =
  | AssociableHotspot
  | Gap
  | GapImg
  | GapText
  | HotspotChoice
  | HotText
  | InlineChoice
  | SimpleAssociableChoice
  | SimpleChoice
  | TemplateBlock
  | TemplateInline;
type Feedback = FeedbackBlock | FeedbackInline;
type Param = Extract<HtmlElement, { kind: "param" }>;
type XmlElement = Extract<BodyNode, { kind: "element" }>;

const isTemplateControlled = (node: ModelNode): node is TemplateControlled => TEMPLATE_CONTROLLED.has(node.kind);
const isFeedback = (node: ModelNode): node is Feedback =>
  node.kind === "feedback-block" || node.kind === "feedback-inline";
const isPrintedVariable = (node: ModelNode): node is PrintedVariable => node.kind === "printed-variable";
const isRubricBlock = (node: ModelNode): node is RubricBlock => node.kind === "rubric-block";
const isParam = (node: ModelNode): node is Param => node.kind === "param";
const isXmlElement = (node: ModelNode): node is XmlElement => node.kind === "element";

/** What resolution needs of an item and its variables, worked out once. */
interface Resolution {
  readonly variables: ContentVariables;
  readonly view: View;
  /** The text of each template variable that `param-variable` substitutes in `object` parameters. */
  readonly parameters: ReadonlyMap<string, string>;
  /** The text of each template variable that `math-variable` substitutes in MathML. */
  readonly numbers: ReadonlyMap<string, string>;
}

function lookup(variables: ContentVariables, identifier: string): Value | null {
  return variables.outcomes.has(identifier)
    ? (variables.outcomes.get(identifier) ?? null)
    : (variables.templates.get(identifier) ?? null);
}

function substitutions(item: AssessmentItem, variables: ContentVariables): Pick<Resolution, "numbers" | "parameters"> {
  const parameters = new Map<string, string>();
  const numbers = new Map<string, string>();
  for (const declaration of item.templateDeclarations) {
    const text = templateText(variables.templates.get(declaration.identifier));
    if (text === undefined) continue;
    if (declaration.paramVariable === true) parameters.set(declaration.identifier, text);
    if (declaration.mathVariable === true) numbers.set(declaration.identifier, text);
  }
  return { parameters, numbers };
}

/** Returns whether resolution keeps a node: hidden feedback, template content and choices, and rubric for other views, go. */
function isKept(node: ModelNode, resolution: Resolution): boolean {
  const { variables, view } = resolution;
  if (isTemplateControlled(node)) {
    const { templateIdentifier } = node;
    return (
      templateIdentifier === undefined ||
      isShown(node.showHide, node.identifier, variables.templates.get(templateIdentifier) ?? null)
    );
  }
  if (isFeedback(node)) {
    return isShown(node.showHide, node.identifier, variables.outcomes.get(node.outcomeIdentifier) ?? null);
  }
  return !isRubricBlock(node) || node.view.includes(view);
}

/** Returns the node that stands for `node` in the resolved content, or `undefined` when the node is dropped. */
function resolveNode(node: ModelNode, resolution: Resolution): ModelNode | TextNode | undefined {
  if (!isKept(node, resolution)) return undefined;
  if (isPrintedVariable(node)) {
    return {
      kind: "text",
      value: formatPrintedVariable(node, lookup(resolution.variables, node.identifier), resolution.variables),
    };
  }
  if (isXmlElement(node)) return resolution.numbers.size === 0 ? node : substituteMath(node, resolution.numbers);
  const copy: { [property: string]: unknown; kind: string } = { ...node };
  for (const [property, content] of Object.entries(node)) {
    copy[property] = Array.isArray(content)
      ? content.flatMap((entry) => (isModelNode(entry) ? (resolveNode(entry, resolution) ?? []) : [entry]))
      : // A node in a place of its own is never one that resolution drops: the places that take hidden content hold lists.
        isModelNode(content)
        ? (resolveNode(content, resolution) ?? content)
        : content;
  }
  if (isParam(node)) {
    const substituted = resolution.parameters.get(node.value);
    if (substituted !== undefined) copy.value = substituted;
  }
  return copy;
}

function checkVariables(variables: unknown): asserts variables is ContentVariables {
  checkRecord(variables, "The variables must be an object with the maps outcomes and templates");
  for (const name of ["outcomes", "templates"]) {
    if (!(variables[name] instanceof Map)) {
      throw new DataError(`The ${name} of the variables must be a Map, found ${describe(variables[name])}.`);
    }
  }
}

/**
 * Resolves the content of an item for the candidate, or for another view: it removes what the variables hide, replaces
 * what they print, and keeps the rest.
 *
 * | Content                                              | Resolution                                                                     |
 * | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
 * | `qti-printed-variable`                               | text, by {@link formatPrintedVariable}; a response variable prints nothing      |
 * | `qti-feedback-block`, `qti-feedback-inline`          | kept when {@link isShown} for the outcome, else removed (INFO §5.49, §5.52)    |
 * | `qti-template-block`, `qti-template-inline`          | kept when shown for the template variable, else removed (INFO §5.122, §5.124)  |
 * | choices, gaps, hotspots and hot texts with a `template-identifier` | removed when the template variable hides them (INFO §2.7.1, B14) |
 * | `qti-rubric-block`                                   | kept when its `view` lists the view, else removed (INFO §2.8.6)                |
 * | `param` of an `object`                               | its `value` replaced when it names a template variable with `param-variable` (INFO §7.29.2) |
 * | `mi` and `ci` of MathML                              | `mn` and `cn` with the value of a template variable with `math-variable` (INFO §2.3.3) |
 *
 * The result has the shape of the input: elements kept have their content resolved in turn, and the choices that stay
 * keep their order. A parameter or a MathML identifier whose variable is NULL, a container or a file stays as authored.
 *
 * @param nodes - The content, such as the children of the item body.
 * @param variables - The outcomes and template variables of the item session.
 * @param item - The item, for the declarations of its template variables.
 * @param options - See {@link ResolveContentOptions}.
 * @returns New nodes; the input is not changed.
 * @throws `DataError` when an argument has the wrong type.
 */
export function resolveContent(
  nodes: readonly BodyNode[],
  variables: ContentVariables,
  item: AssessmentItem,
  options: ResolveContentOptions,
): readonly BodyNode[] {
  checkArray(nodes, "The nodes must be an array");
  checkVariables(variables);
  const input: unknown = item;
  checkRecord(input, "The item must be an object of the model of qti-assessment-item");
  checkArray(input.templateDeclarations, "The template declarations of the item must be an array");
  checkRecord(options, "The options must be an object with the property view");
  checkChoice(options.view, "The option view", VIEWS);
  const resolution: Resolution = { variables, view: options.view, ...substitutions(item, variables) };
  return nodes.flatMap((node) => {
    const resolved = resolveNode(node, resolution);
    return isBodyNode(resolved) ? [resolved] : [];
  });
}
