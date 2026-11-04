import type { PortableCustomInteraction } from "../asi/index.js";
import { describe } from "../checks.js";
import type { Issue } from "../errors.js";
import { type PciModuleConfiguration, resolvePciModules } from "./resolve-modules.js";

const ELEMENT = "qti-portable-custom-interaction";

/** The start of a Federated Content URN, the recommended form of `custom-interaction-type-identifier`. */
const FEDERATED_CONTENT_URN = "urn:fdc:";

/**
 * Checks that a portable custom interaction names modules the configuration defines, and how it names its type.
 *
 * @remarks
 * | Code                                  | Severity | Reported when                                                                                     |
 * | ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
 * | `assesskit/pci/no-module`             | error    | the interaction has neither a `module` attribute nor a `qti-interaction-modules`                  |
 * | `assesskit/pci/module-not-configured` | error    | the `module` or a `qti-interaction-module` has no location in the configurations or its own paths |
 * | `assesskit/pci/type-identifier`       | warning  | `custom-interaction-type-identifier` is not a Federated Content URN (`urn:fdc:...`)               |
 *
 * @param interaction - The PCI.
 * @param configuration - The configuration files that `resolveModuleConfigurationPaths` names, parsed.
 * @returns The issues, in the order of the table.
 * @throws `DataError` when an argument has the wrong type.
 * @see
 * {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, portable custom interactions}
 * @see {@link https://www.rfc-editor.org/rfc/rfc4198 | RFC 4198, Federated Content URNs}
 */
export function validatePortableInteraction(
  interaction: PortableCustomInteraction,
  configuration: PciModuleConfiguration,
): readonly Issue[] {
  const modules = resolvePciModules(interaction, configuration);
  const issues: Issue[] = [];
  const located = new Set(
    modules
      .filter((module) => module.primary !== undefined || module.fallback !== undefined)
      .map((module) => module.id),
  );
  if (interaction.module === undefined && interaction.interactionModules === undefined) {
    issues.push({
      severity: "error",
      code: "assesskit/pci/no-module",
      message: `The interaction with the response identifier ${describe(interaction.responseIdentifier)} has neither a module attribute nor a qti-interaction-modules element, so no module can be loaded for it.`,
      location: { element: ELEMENT },
    });
  }
  const named = [
    ...(interaction.module === undefined ? [] : [interaction.module]),
    ...(interaction.interactionModules?.interactionModules ?? []).map((module) => module.id),
  ];
  for (const id of new Set(named)) {
    if (located.has(id)) continue;
    issues.push({
      severity: "error",
      code: "assesskit/pci/module-not-configured",
      message: `The interaction names the module ${describe(id)}, which no module resolution configuration and no qti-interaction-module gives a location. It must name an AMD module that the configuration defines.`,
      location: { element: ELEMENT },
    });
  }
  if (!interaction.customInteractionTypeIdentifier.toLowerCase().startsWith(FEDERATED_CONTENT_URN)) {
    issues.push({
      severity: "warning",
      code: "assesskit/pci/type-identifier",
      message: `The custom-interaction-type-identifier ${describe(interaction.customInteractionTypeIdentifier)} is not a Federated Content URN such as urn:fdc:example.com:2024:pci:graph, which prevents collisions between the names of different implementers.`,
      location: { element: ELEMENT },
    });
  }
  return issues;
}
