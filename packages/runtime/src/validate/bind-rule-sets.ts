import { ASI_NAMESPACE, type ElementVisit, type ResponseDeclaration } from "../asi/index.js";
import { QTI_CONTEXT } from "../processing/index.js";
import type { BaseType } from "../values/index.js";
import type { XmlElement } from "../xml/index.js";
import type { Findings } from "./findings.js";
import { elementPath, extensionsOf, kindsOf, numberOf } from "./model-access.js";

/** The number of a rule set `RULE_SET_INTERACTION_<number>A` or `B` of the XML binding, by the element it is about. */
const INTERACTION_RULE_SETS: ReadonlyMap<string, number> = new Map([
  ["qti-text-entry-interaction", 1],
  ["qti-choice-interaction", 2],
  ["qti-inline-choice-interaction", 2],
  ["qti-extended-text-interaction", 3],
  ["qti-hotspot-interaction", 4],
  ["qti-graphic-order-interaction", 5],
  ["qti-position-object-interaction", 6],
  ["qti-select-point-interaction", 7],
  ["qti-order-interaction", 8],
  ["qti-hottext-interaction", 9],
  ["qti-graphic-associate-interaction", 10],
  ["qti-match-interaction", 11],
  ["qti-associate-interaction", 12],
  ["qti-media-interaction", 13],
  ["qti-slider-interaction", 14],
  ["qti-drawing-interaction", 15],
  ["qti-upload-interaction", 16],
  ["qti-end-attempt-interaction", 17],
  ["qti-gap-match-interaction", 18],
  ["qti-graphic-gap-match-interaction", 19],
  ["qti-custom-interaction", 20],
  ["qti-portable-custom-interaction", 20],
]);

/** The interactions whose `max-choices` must not be below `min-choices`, unless it is 0. */
const CHOICE_LIMITS = new Set([
  "qti-choice-interaction",
  "qti-hotspot-interaction",
  "qti-graphic-order-interaction",
  "qti-position-object-interaction",
  "qti-select-point-interaction",
  "qti-order-interaction",
  "qti-hottext-interaction",
]);

/** The interactions whose `max-associations` must not be below `min-associations`, unless it is 0. */
const ASSOCIATION_LIMITS = new Set([
  "qti-graphic-associate-interaction",
  "qti-match-interaction",
  "qti-associate-interaction",
  "qti-gap-match-interaction",
]);

/** The interactions whose `string-identifier` must differ from the `response-identifier`. */
const STRING_IDENTIFIERS = new Set(["qti-text-entry-interaction", "qti-extended-text-interaction"]);

/**
 * The base types that the response declaration of an interaction must have, where the XML binding fixes them. A response of the
 * text entry may be a record instead, which has no base type (`RECORD_RESPONSES`).
 */
const BOUND_BASE_TYPES: ReadonlyMap<string, readonly BaseType[]> = new Map([
  ["qti-text-entry-interaction", ["string", "float", "integer"]],
  ["qti-drawing-interaction", ["file"]],
  ["qti-upload-interaction", ["file"]],
  ["qti-end-attempt-interaction", ["boolean"]],
  ["qti-gap-match-interaction", ["directedPair"]],
  ["qti-graphic-gap-match-interaction", ["directedPair"]],
]);

/**
 * The interactions whose response may have the cardinality record. The information model lets the text entry bind a record with
 * the fields `stringValue`, `floatValue` and the rest, while rule 1Bb of the XML binding says its base type is string, float or
 * integer, which a record lacks; the information model decides.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, TextEntryInteraction}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
const RECORD_RESPONSES = new Set(["qti-text-entry-interaction"]);

/** The elements with `match-max` and `match-min`, by the number of their rule set `RULE_SET_INTERACTION-RELATED_<number>`. */
const MATCH_LIMITS: ReadonlyMap<string, number> = new Map([
  ["qti-gap-text", 1],
  ["qti-gap-img", 2],
  ["qti-associable-hotspot", 3],
  ["qti-simple-associable-choice", 4],
]);

/** The values of `role` that `h1` may have. */
const H1_ROLES = new Set(["heading", "tab", "presentation"]);

/**
 * The element whose schema allows attributes of other namespaces and that the XML binding constrains to `data-` attributes all
 * the same, as the elements whose schema allows any attribute.
 */
const CONSTRAINED_FOREIGN = "qti-custom-interaction";

/** What an extension attribute of a constrained element is named: `data-` and one or more name characters. */
const DATA_ATTRIBUTE = /^data-[a-zA-Z0-9_.-]+$/;

/** The rule of the issue for a `figure` with more than one `figcaption`, which the XML binding allows once at most. */
const FIGURE_CODE = "assesskit/validate/figure-multiplicity";

/** Returns the property of the model for an attribute name: `max-choices` becomes `maxChoices`. */
function camelCase(attribute: string): string {
  return attribute.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function ruleSet(number: number, part: "A" | "B"): string {
  return `RULE_SET_INTERACTION_${String(number).padStart(2, "0")}${part}`;
}

/** Returns the names of the interactions among the elements of the ASI namespace in XML trees, at any depth. */
function interactionsIn(elements: readonly XmlElement[]): string[] {
  return elements.flatMap((element) => [
    ...(element.namespace === ASI_NAMESPACE && element.name.endsWith("-interaction") ? [element.name] : []),
    ...interactionsIn(element.children.filter((child): child is XmlElement => child.kind === "element")),
  ]);
}

/** What the rule sets read of the document around an element: the declarations of the item. */
export interface BindContext {
  /** The response declarations of the item by identifier. */
  readonly responses: ReadonlyMap<string, ResponseDeclaration>;
  /** The identifiers of the context variables of the item, `QTI_CONTEXT` included. */
  readonly contexts: ReadonlySet<string>;
  /** The identifiers of the template variables of the item. */
  readonly templates: ReadonlySet<string>;
}

/** Applies the rule sets of the XML binding to the elements of a document that they are about. */
export class BindRuleSets {
  private readonly findings: Findings;
  private readonly context: BindContext | undefined;

  /**
   * @param findings - Where the issues go.
   * @param context - The declarations of the item that holds the elements, absent for a document that is not an item,
   * whose rules about declarations then do not apply.
   */
  constructor(findings: Findings, context: BindContext | undefined) {
    this.findings = findings;
    this.context = context;
  }

  /**
   * Checks one element against every rule set about it.
   *
   * @param visit - The element that the walk of the document reached.
   */
  visit(visit: ElementVisit): void {
    const { name } = visit;
    this.figureCaption(visit);
    this.ariaRole(visit);
    this.nestedInteraction(visit);
    this.interactionAttributes(visit);
    if (MATCH_LIMITS.has(name)) this.matchLimits(visit);
    if (name === "qti-rubric-block") this.rubricBlock(visit);
    if (name === "qti-outcome-declaration") this.outcomeDeclaration(visit);
    if (name === "qti-choice-interaction") this.responseDeclaration(visit);
    if (name === "qti-context-variable" || name === "qti-template-variable") this.portableVariable(visit);
    if (visit.attributeWildcard === "any" || visit.name === CONSTRAINED_FOREIGN) this.extensionAttributes(visit);
  }

  private error(rule: string, message: string, visit: ElementVisit): void {
    this.findings.error(rule, message, elementPath(visit));
  }

  /**
   * 5.1.1: a `figure` has at most one `figcaption`. The rule of a `ruby` (5.1.2) is not applied: the information model gives
   * each group of a `ruby` the multiplicities that the XML binding gives the element, and the schema limits none.
   *
   * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
   */
  private figureCaption(visit: ElementVisit): void {
    if (visit.name !== "figure") return;
    const count = kindsOf(visit.model, "children").filter((kind) => kind === "figcaption").length;
    if (count > 1) {
      const message = `The figure has ${count} figcaption elements, but the multiplicity of figcaption must be 0 or 1.`;
      this.error(FIGURE_CODE, message, visit);
    }
  }

  /** 5.3.1 RULE_SET_ARIA_ROLES_1. */
  private ariaRole(visit: ElementVisit): void {
    const role = visit.model.role;
    if (role === undefined) return;
    if (visit.name === "source") {
      this.error("RULE_SET_ARIA_ROLES_1", "The 'source' tag must not have an ARIA role attribute.", visit);
    } else if (visit.name === "h1" && !H1_ROLES.has(String(role))) {
      const message = `The 'h1' tag may have an ARIA role value of 'heading' or 'tab' or 'presentation' only, found ${JSON.stringify(role)}.`;
      this.error("RULE_SET_ARIA_ROLES_1", message, visit);
    }
  }

  /** 5.3.3 and the other rule sets A: an interaction does not contain another. */
  private nestedInteraction(visit: ElementVisit): void {
    if (visit.name.endsWith("-interaction")) {
      for (let at = visit.parent; at !== undefined; at = at.parent) {
        if (INTERACTION_RULE_SETS.has(at.name)) {
          this.nested(at, visit.name, visit);
          break;
        }
      }
    }
    // The content of a custom interaction and the markup of a portable one stays XML, so its interactions are in `foreign`.
    const container = INTERACTION_RULE_SETS.has(visit.name) ? visit : this.interactionAbove(visit);
    if (container === undefined) return;
    for (const name of interactionsIn(visit.foreign)) this.nested(container, name, visit);
  }

  private interactionAbove(visit: ElementVisit): ElementVisit | undefined {
    for (let at = visit.parent; at !== undefined; at = at.parent) if (INTERACTION_RULE_SETS.has(at.name)) return at;
    return undefined;
  }

  private nested(container: ElementVisit, name: string, visit: ElementVisit): void {
    const number = INTERACTION_RULE_SETS.get(container.name);
    if (number === undefined) return;
    const message = `The ${container.name} must not contain the ${name}: an interaction may not be nested within another interaction.`;
    this.error(ruleSet(number, "A"), message, visit);
  }

  /** The rule sets B of the interactions: their attributes, and the base type of their response. */
  private interactionAttributes(visit: ElementVisit): void {
    const { name, model } = visit;
    const number = INTERACTION_RULE_SETS.get(name);
    if (number === undefined) return;
    const rule = ruleSet(number, "B");
    const report = (message: string): void => this.error(rule, message, visit);
    if (CHOICE_LIMITS.has(name)) this.checkRange(visit, report, ["max-choices", "min-choices"], true);
    if (ASSOCIATION_LIMITS.has(name)) this.checkRange(visit, report, ["max-associations", "min-associations"], true);
    if (name === "qti-media-interaction") this.checkRange(visit, report, ["max-plays", "min-plays"], false);
    if (name === "qti-slider-interaction") this.checkRange(visit, report, ["upper-bound", "lower-bound"], false);
    if (
      STRING_IDENTIFIERS.has(name) &&
      model.stringIdentifier !== undefined &&
      model.stringIdentifier === model.responseIdentifier
    ) {
      report(
        `The string-identifier and response-identifier attribute values of the ${name} must not be the same, found ${JSON.stringify(model.responseIdentifier)}.`,
      );
    }
    const baseTypes = BOUND_BASE_TYPES.get(name);
    const declaration = this.context?.responses.get(String(model.responseIdentifier));
    if (
      baseTypes !== undefined &&
      declaration !== undefined &&
      !(declaration.cardinality === "record" && RECORD_RESPONSES.has(name)) &&
      !(declaration.baseType !== undefined && baseTypes.includes(declaration.baseType))
    ) {
      report(
        `The base-type of the response variable ${JSON.stringify(declaration.identifier)} of the ${name} must be ${baseTypes.join(", ")}, found ${declaration.baseType ?? "none"}.`,
      );
    }
  }

  /**
   * Reports a maximum below its minimum, given the attributes as written, such as `max-choices` and `min-choices`. A
   * maximum of 0 means no limit where `zeroIsUnlimited` is set.
   */
  private checkRange(
    visit: ElementVisit,
    report: (message: string) => void,
    [maxName, minName]: readonly [string, string],
    zeroIsUnlimited: boolean,
  ): void {
    const max = numberOf(visit.model, camelCase(maxName));
    const min = numberOf(visit.model, camelCase(minName));
    if (max === undefined || min === undefined || max >= min || (zeroIsUnlimited && max === 0)) return;
    const unlimited = zeroIsUnlimited ? ", provided it is not 0," : "";
    report(
      `The ${maxName} attribute value${unlimited} must not be less than the ${minName} value, found ${max} and ${min} in the ${visit.name}.`,
    );
  }

  /** 5.3.43 to 5.3.46: `match-max`, unless it is 0, must not be below `match-min`. */
  private matchLimits(visit: ElementVisit): void {
    const max = numberOf(visit.model, "matchMax");
    const min = numberOf(visit.model, "matchMin");
    const number = MATCH_LIMITS.get(visit.name);
    if (number === undefined || max === undefined || min === undefined || max === 0 || max >= min) return;
    const message = `The match-max attribute value, provided it is not 0, must not be less than the match-min value, found ${max} and ${min} in the ${visit.name}.`;
    this.error(`RULE_SET_INTERACTION-RELATED_${number}`, message, visit);
  }

  /** RULE_SET_RUBRICBLOCK, and the Information Model: a rubric block holds no rubric block and no interaction. */
  private rubricBlock(visit: ElementVisit): void {
    for (let at = visit.parent; at !== undefined; at = at.parent) {
      if (at.name !== "qti-rubric-block") continue;
      const message =
        "The qti-rubric-block must not be a child of a qti-rubric-block: rubric blocks may not be nested.";
      this.error("RULE_SET_RUBRICBLOCK", message, visit);
      return;
    }
  }

  /** 5.3.48 RULE_SET_SPECIFIC_CLASS_OUTCOMEDEC. */
  private outcomeDeclaration(visit: ElementVisit): void {
    const mastery = numberOf(visit.model, "masteryValue");
    if (mastery === undefined) return;
    const minimum = numberOf(visit.model, "normalMinimum");
    const maximum = numberOf(visit.model, "normalMaximum");
    const name = JSON.stringify(visit.model.identifier);
    if (minimum !== undefined && mastery < minimum) {
      const message = `The mastery-value ${mastery} of the outcome ${name} must not be less than its normal-minimum ${minimum}.`;
      this.error("RULE_SET_SPECIFIC_CLASS_OUTCOMEDEC", message, visit);
    }
    if (maximum !== undefined && mastery > maximum) {
      const message = `The mastery-value ${mastery} of the outcome ${name} must not be greater than its normal-maximum ${maximum}.`;
      this.error("RULE_SET_SPECIFIC_CLASS_OUTCOMEDEC", message, visit);
    }
  }

  /**
   * 5.3.49 RULE_SET_SPECIFIC_CLASS_RESPONSEDEC: a response variable bound to a choice interaction with a `max-choices`
   * other than 1 is a container. The first rule of the set is about the `max-choices` of an inline choice interaction,
   * which the schema does not give that element, so it cannot apply.
   */
  private responseDeclaration(visit: ElementVisit): void {
    const max = numberOf(visit.model, "maxChoices");
    const declaration = this.context?.responses.get(String(visit.model.responseIdentifier));
    if (max === undefined || max === 1 || declaration?.cardinality !== "single") return;
    const message = `The response variable ${JSON.stringify(declaration.identifier)} has the cardinality single, which is inconsistent with the max-choices ${max} of the qti-choice-interaction bound to it.`;
    this.error("RULE_SET_SPECIFIC_CLASS_RESPONSEDEC", message, visit);
  }

  /** 5.3.42 RULE_SET_INTERACTION_20B: the variables a portable custom interaction passes are declared by the item. */
  private portableVariable(visit: ElementVisit): void {
    if (this.context === undefined || visit.parent?.name !== "qti-portable-custom-interaction") return;
    const isContext = visit.name === "qti-context-variable";
    const identifier = String(isContext ? visit.model.identifier : visit.model.templateIdentifier);
    const declared = isContext
      ? identifier === QTI_CONTEXT || this.context.contexts.has(identifier)
      : this.context.templates.has(identifier);
    if (declared) return;
    const kind = isContext ? "context" : "template";
    const message = `The '${visit.name}' ${JSON.stringify(identifier)} does NOT have a value defined by a '${kind}-declaration' in the parent AssessmentItem.`;
    this.error("RULE_SET_INTERACTION_20B", message, visit);
  }

  /** 5.2: the attributes beyond the schema's on an element of the list are `data-` attributes of no namespace. */
  private extensionAttributes(visit: ElementVisit): void {
    for (const attribute of extensionsOf(visit.model)) {
      if (attribute.namespace === "" && DATA_ATTRIBUTE.test(attribute.name)) continue;
      const qualified = attribute.prefix === undefined ? attribute.name : `${attribute.prefix}:${attribute.name}`;
      const message = `The attribute ${qualified} of the ${visit.name} is not defined by the schema, and an extension attribute must be named data- followed by letters, digits, underscores, hyphens or periods.`;
      this.error("assesskit/validate/extension-attribute", message, visit);
    }
  }
}
