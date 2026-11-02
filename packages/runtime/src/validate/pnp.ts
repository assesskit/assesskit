import { checkRecord } from "../checks.js";
import type { Issue } from "../errors.js";
import { type PersonalNeedsProfile, PNP_ALTERNATE_NAMESPACES, PNP_NAMESPACE } from "../pnp/index.js";
import type { XmlElement } from "../xml/index.js";
import { Findings, FindingsLimit } from "./findings.js";
import { checkMaxFindings, type ValidateOptions } from "./options.js";

/**
 * Validates a personal needs profile: a support in the prohibit set is listed only there. A support that the
 * profile also assigns is a recommendation broken, and one that an activate set also lists is a contradiction. A support
 * in both activate sets is on from the start and also an option, which the profile cannot mean. A color theme is in the best
 * practices guide and not in the PNP schema, so a document with one does not pass the schema (spec gaps, G49).
 *
 * | Code                                  | Severity | Reported when                                  |
 * | ------------------------------------- | -------- | ---------------------------------------------- |
 * | `assesskit/validate/pnp-prohibited`   | error    | a prohibited support is in an activate set     |
 * | `assesskit/validate/pnp-prohibited`   | warning  | a prohibited support is also assigned          |
 * | `assesskit/validate/pnp-sets`         | warning  | a support is in both activate sets             |
 * | `assesskit/validate/pnp-color-theme`  | warning  | `text-appearance` has a color theme            |
 *
 * @param profile - The profile, as `readPnp` reads it.
 * @returns The issues; none when the profile is valid.
 * @throws `DataError` when `profile` is not an object of the model of a personal needs profile.
 */
export function validatePnp(profile: PersonalNeedsProfile): readonly Issue[] {
  checkRecord(profile, "The profile must be an object of the model of a personal needs profile");
  // The issues are at most three for each support name of the vocabulary and one for the color theme, far below the default limit.
  const findings = new Findings();
  const element = "access-for-all-pnp";
  for (const name of profile.prohibited) {
    if (profile.activateAsOption.has(name) || profile.activateAtInitialization.has(name)) {
      const message = `The support ${name} is in the prohibit set and in an activate set; the only listing of a prohibited support must be in the prohibit set.`;
      findings.error("assesskit/validate/pnp-prohibited", message, element);
    }
    if (profile.supports.has(name)) {
      const message = `The support ${name} is in the prohibit set and the profile also assigns it; a prohibited support should not be assigned.`;
      findings.warning("assesskit/validate/pnp-prohibited", message, element);
    }
  }
  for (const name of profile.activateAsOption) {
    if (!profile.activateAtInitialization.has(name)) continue;
    const message = `The support ${name} is in the activate-as-option set and the activate-at-initialization set; it is either on from the start or an option the candidate turns on.`;
    findings.warning("assesskit/validate/pnp-sets", message, element);
  }
  const appearance = profile.supports.get("text-appearance");
  if (appearance?.name === "text-appearance" && appearance.colorTheme !== undefined) {
    const message = `The support text-appearance has the color theme ${appearance.colorTheme}. The best practices guide has color-theme and the PNP schema does not, so a validator of the schema refuses the document, and writePnp leaves the theme out.`;
    findings.warning("assesskit/validate/pnp-color-theme", message, `${element}/text-appearance/color-theme`);
  }
  return findings.list();
}

/**
 * Reports the elements of a PNP document that are in one of the two namespaces that 1EdTech's own documents use
 * instead of the schema's: those of the examples of the best practices guide and of the XML binding. `readPnp` reads them, `writePnp`
 * writes the namespace of the schema, and the document is an error because the schema does not validate it. One issue
 * is reported for each element whose parent is not in such a namespace.
 *
 * @param root - The root element of the document, as `parseXml` returns it.
 * @param options - `maxFindings`, as {@link ValidateOptions} has it.
 * @returns One error for each part of the document in an alternate namespace, up to `maxFindings`; none when it uses the
 * namespace of the schema.
 * @throws `DataError` when `root` is not an element, or `maxFindings` is not a positive integer.
 */
export function validatePnpNamespace(
  root: XmlElement,
  options: Pick<ValidateOptions, "maxFindings"> = {},
): readonly Issue[] {
  checkRecord(root, "The root must be an element as parseXml returns it");
  const findings = new Findings(undefined, new FindingsLimit(checkMaxFindings(options)));
  const visit = (element: XmlElement, parent: string, parentAlternate: boolean): void => {
    const alternate = PNP_ALTERNATE_NAMESPACES.includes(element.namespace);
    const path = `${parent}${element.name}`;
    if (alternate && !parentAlternate) {
      const message = `The element ${element.name} is in the namespace ${element.namespace}, which is not the namespace of the PNP schema. Use ${PNP_NAMESPACE}.`;
      findings.error("assesskit/validate/pnp-namespace", message, path);
    }
    for (const child of element.children) if (child.kind === "element") visit(child, `${path}/`, alternate);
  };
  visit(root, "", false);
  return findings.list();
}
