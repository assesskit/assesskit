import type { AssessmentItem } from "../asi/index.js";
import { describe } from "../checks.js";
import type { Issue } from "../errors.js";
import type { ValueDeclaration } from "../values/index.js";
import { describeInteractions } from "./describe.js";
import type { Binding, InteractionDescriptor } from "./descriptor.js";

/** Names a binding for a message, such as `single identifier` or `record`. */
function nameBinding(cardinality: string, baseType: string | undefined): string {
  return baseType === undefined || cardinality === "record" ? cardinality : `${cardinality} ${baseType}`;
}

/** Lists the names of the bindings an interaction accepts: `a, b or c`. */
function listBindings(bindings: readonly Binding[]): string {
  const names = bindings.flatMap(({ cardinality, baseTypes }) =>
    baseTypes.length === 0
      ? [nameBinding(cardinality, undefined)]
      : baseTypes.map((baseType) => nameBinding(cardinality, baseType)),
  );
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/** Returns whether the bindings of an interaction accept a declared variable. */
function accepts(bindings: readonly Binding[], declaration: ValueDeclaration): boolean {
  return bindings.some(
    ({ cardinality, baseTypes }) =>
      cardinality === declaration.cardinality &&
      (cardinality === "record" || (declaration.baseType !== undefined && baseTypes.includes(declaration.baseType))),
  );
}

function issue(rule: string, message: string, descriptor: InteractionDescriptor): Issue {
  return { severity: "error", rule, message, location: { element: `qti-${descriptor.kind}` } };
}

/**
 * Checks that the response variables of an item suit the interactions bound to them.
 *
 * @remarks
 * | Rule                                          | Reported when                                                                           |
 * | --------------------------------------------- | --------------------------------------------------------------------------------------- |
 * | `assesskit/interactions/response-undeclared`  | an interaction names a response variable that the item does not declare                 |
 * | `assesskit/interactions/binding`              | the variable has a cardinality or base type that the interaction does not accept        |
 * | `assesskit/interactions/response-bound-twice` | a variable is bound to more than one interaction, including through `string-identifier` |
 * | `assesskit/interactions/string-identifier`    | `string-identifier` names a variable that is not declared as a single string            |
 *
 * The bindings that an interaction accepts depend on its attributes: with `max-choices` above 1 or 0 the response must
 * have cardinality `multiple`. Custom interactions and portable custom interactions accept any binding.
 *
 * @param item - The item, as `readAsi` reads it.
 * @returns One error per violation, in document order; none when every interaction is bound as the specification
 * demands.
 * @throws `DataError` when `item` is not an object of the model of `qti-assessment-item`.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function validateBindings(item: AssessmentItem): readonly Issue[] {
  const descriptors = describeInteractions(item);
  const declared = new Map(item.responseDeclarations.map((declaration) => [declaration.identifier, declaration]));
  const issues: Issue[] = [];
  const bound = new Set<string>();
  const bind = (descriptor: InteractionDescriptor, identifier: string): void => {
    if (bound.has(identifier)) {
      issues.push(
        issue(
          "assesskit/interactions/response-bound-twice",
          `The response variable ${describe(identifier)} is bound to more than one interaction, but each response variable may be bound to one and only one interaction.`,
          descriptor,
        ),
      );
    }
    bound.add(identifier);
  };
  for (const descriptor of descriptors) {
    const { responseIdentifier, declaration, stringIdentifier, kind } = descriptor;
    bind(descriptor, responseIdentifier);
    if (declaration === undefined) {
      issues.push(
        issue(
          "assesskit/interactions/response-undeclared",
          `The interaction qti-${kind} is bound to the response variable ${describe(responseIdentifier)}, which the item does not declare. Declare it with a qti-response-declaration.`,
          descriptor,
        ),
      );
    } else if (!accepts(descriptor.bindings, declaration)) {
      issues.push(
        issue(
          "assesskit/interactions/binding",
          `The interaction qti-${kind} is bound to ${describe(responseIdentifier)}, a variable with the type ${nameBinding(declaration.cardinality, declaration.baseType)}, but it accepts ${listBindings(descriptor.bindings)} here.`,
          descriptor,
        ),
      );
    }
    if (stringIdentifier === undefined) continue;
    bind(descriptor, stringIdentifier);
    const second = declared.get(stringIdentifier);
    if (second === undefined || second.cardinality !== "single" || second.baseType !== "string") {
      issues.push(
        issue(
          "assesskit/interactions/string-identifier",
          `The attribute string-identifier of qti-${kind} names ${describe(stringIdentifier)}, which must be a response variable declared with cardinality single and base type string.`,
          descriptor,
        ),
      );
    }
  }
  return issues;
}
