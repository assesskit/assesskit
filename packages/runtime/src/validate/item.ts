import { type AssessmentItem, walkDocument } from "../asi/index.js";
import { checkBindings, describeInteractions } from "../interactions/index.js";
import { QTI_CONTEXT } from "../processing/index.js";
import { AttributeReferences } from "./attribute-references.js";
import { BindRuleSets } from "./bind-rule-sets.js";
import { ContentReferences } from "./content-references.js";
import { checkDeclarations } from "./declarations.js";
import { DocumentChecks } from "./document-checks.js";
import { ExpressionChecker } from "./expressions.js";
import type { Findings } from "./findings.js";
import { FormatChecks } from "./formats.js";
import { ItemScope, itemVariables } from "./item-scope.js";
import type { CheckedOptions } from "./options.js";
import { responseRulesOf } from "./response-rules.js";
import { RuleChecker } from "./rules.js";
import { checkScoringRubrics } from "./scoring-rubric.js";
import { checkConstraintDefaults } from "./template-constraints.js";
import { UnreachableContent } from "./unreachable-content.js";

const TRAIL = "qti-assessment-item";

/** The identifiers of the response variables that an interaction binds, the second variable of a text entry included. */
function boundResponses(item: AssessmentItem): ReadonlySet<string> {
  return new Set(
    describeInteractions(item).flatMap(({ responseIdentifier, stringIdentifier }) =>
      stringIdentifier === undefined ? [responseIdentifier] : [responseIdentifier, stringIdentifier],
    ),
  );
}

/**
 * Runs every check on an item: the rule sets of the XML binding, the formats of its text attributes, its declarations, the
 * bindings of its interactions, the variables its content names, its scoring rubrics, and the static types of its template
 * and response processing.
 *
 * @param item - The item.
 * @param findings - The findings of the document, which receive the issues.
 * @param options - The checked options.
 */
export function checkItem(item: AssessmentItem, findings: Findings, options: CheckedOptions): void {
  const responseScope = new ItemScope(item, "response");
  const templateScope = new ItemScope(item, "template");
  const variables = itemVariables(item);
  const bind = new BindRuleSets(findings, {
    responses: new Map(item.responseDeclarations.map((declaration) => [declaration.identifier, declaration])),
    contexts: new Set([QTI_CONTEXT, ...item.contextDeclarations.map(({ identifier }) => identifier)]),
    templates: new Set(item.templateDeclarations.map(({ identifier }) => identifier)),
  });
  const formats = new FormatChecks(findings);
  const content = new ContentReferences(findings, (identifier) => variables.get(identifier), "item");
  const references = new AttributeReferences(
    findings,
    (identifier, templateProcessing) => (templateProcessing ? templateScope : responseScope).reference(identifier),
    "item",
  );
  const unreachable = new UnreachableContent();
  const document = new DocumentChecks(findings);
  walkDocument({ kind: "item", item }, (visit) => {
    document.visit(visit);
    bind.visit(visit);
    formats.visit(visit);
    content.visit(visit);
    references.visit(visit);
    unreachable.visit(visit);
  });
  formats.finish();
  checkDeclarations(findings, {
    owner: "item",
    trail: TRAIL,
    builtIn: ["numAttempts", "duration", "completionStatus", QTI_CONTEXT],
    groups: [
      { element: "qti-context-declaration", declarations: item.contextDeclarations },
      { element: "qti-response-declaration", declarations: item.responseDeclarations },
      { element: "qti-outcome-declaration", declarations: item.outcomeDeclarations },
      { element: "qti-template-declaration", declarations: item.templateDeclarations },
    ],
  });
  findings.adopt(checkBindings(item));
  checkScoringRubrics(item, findings);
  const bound = boundResponses(item);
  for (const { identifier } of item.responseDeclarations) {
    if (bound.has(identifier)) continue;
    const message = `The response variable ${JSON.stringify(identifier)} is bound to no interaction, so the candidate cannot give it a value.`;
    findings.warning("assesskit/validate/unbound-response", message, `${TRAIL}/qti-response-declaration`);
  }
  const templateRules = item.templateProcessing?.rules ?? [];
  new RuleChecker(
    findings,
    templateScope,
    new ExpressionChecker(findings, templateScope, options.customOperators),
  ).templateRules(templateRules, `${TRAIL}/qti-template-processing`);
  const response = responseRulesOf(item.responseProcessing, options.resolveTemplate, findings, TRAIL);
  if (response !== undefined) {
    const expressions = new ExpressionChecker(findings, responseScope, options.customOperators);
    new RuleChecker(findings, responseScope, expressions).outcomeRules(response.rules, response.element);
  }
  checkConstraintDefaults(item, findings);
  unreachable.report(
    item,
    response?.complete === false ? undefined : [...templateRules, ...(response?.rules ?? [])],
    findings,
  );
}
