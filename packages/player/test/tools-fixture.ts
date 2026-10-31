import { ASI_NAMESPACE, type CompanionMaterialsInfo, readAsi } from "@assesskit/runtime/asi";

/** The rule of BPIG §3.7.8.2, with the element names of the schema (`qti-rule-system-si`). */
export const RULE_XML = `<qti-rule>
  <qti-description>A metric ruler with increments on one side of the rule.</qti-description>
  <qti-rule-system-si>
    <qti-minimum-length>10</qti-minimum-length>
    <qti-minor-increment unit="Meter">0.5</qti-minor-increment>
    <qti-major-increment unit="Meter">1.0</qti-major-increment>
  </qti-rule-system-si>
</qti-rule>`;

/** The description of {@link RULE_XML}. */
export const RULE_DESCRIPTION = "A metric ruler with increments on one side of the rule.";

/** The protractor of BPIG §3.7.8.3. */
export const PROTRACTOR_XML = `<qti-protractor>
  <qti-description>A floating, transparent protractor that can be moved over the angles in the item.</qti-description>
  <qti-increment-us>
    <qti-minor-increment unit="Degree">1.0</qti-minor-increment>
    <qti-major-increment unit="Degree">5.0</qti-major-increment>
  </qti-increment-us>
</qti-protractor>`;

/** The description of {@link PROTRACTOR_XML}. */
export const PROTRACTOR_DESCRIPTION =
  "A floating, transparent protractor that can be moved over the angles in the item.";

/** Escapes text for XML. */
const escaped = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Builds a `qti-calculator` (BPIG §3.7.8.1), with the file of the calculator when the item gives one (INFO §5.24.3). */
export const calculatorXml = (
  type: string,
  description: string,
  file?: { href: string; label?: string; mimeType?: string },
): string => {
  const label = file?.label === undefined ? "" : ` label="${escaped(file.label)}"`;
  const mimeType = file?.mimeType === undefined ? "" : ` mime-type="${file.mimeType}"`;
  const info =
    file === undefined
      ? ""
      : `<qti-calculator-info${label}${mimeType}><qti-file-href>${escaped(file.href)}</qti-file-href></qti-calculator-info>`;
  return `<qti-calculator><qti-calculator-type>${type}</qti-calculator-type><qti-description>${escaped(description)}</qti-description>${info}</qti-calculator>`;
};

/** Builds a `qti-rule` with its rule system, SI when the units are metric and US otherwise. */
export function ruleXml(
  description: string,
  minimumLength: number,
  major: readonly [string, string],
  minor?: readonly [string, string],
  system: "si" | "us" = "si",
): string {
  const increment = (name: string, [value, unit]: readonly [string, string]): string =>
    `<qti-${name}-increment unit="${unit}">${value}</qti-${name}-increment>`;
  return (
    `<qti-rule><qti-description>${escaped(description)}</qti-description><qti-rule-system-${system}>` +
    `<qti-minimum-length>${minimumLength}</qti-minimum-length>${minor === undefined ? "" : increment("minor", minor)}${increment("major", major)}` +
    `</qti-rule-system-${system}></qti-rule>`
  );
}

/** Builds a `qti-protractor` with its increments, SI (radians) or US (degrees, minutes and seconds). */
export function protractorXml(
  description: string,
  major: readonly [string, string],
  minor?: readonly [string, string],
  system: "si" | "us" = "us",
): string {
  const increment = (name: string, [value, unit]: readonly [string, string]): string =>
    `<qti-${name}-increment unit="${unit}">${value}</qti-${name}-increment>`;
  return (
    `<qti-protractor><qti-description>${escaped(description)}</qti-description><qti-increment-${system}>` +
    `${minor === undefined ? "" : increment("minor", minor)}${increment("major", major)}</qti-increment-${system}></qti-protractor>`
  );
}

/** Builds a `qti-digital-material` (BPIG §3.7.8.4). */
export function digitalXml(
  href: string,
  attributes: { label?: string; mimeType?: string; icon?: string } = {},
): string {
  const label = attributes.label === undefined ? "" : ` label="${escaped(attributes.label)}"`;
  const mimeType = attributes.mimeType === undefined ? "" : ` mime-type="${attributes.mimeType}"`;
  const icon = attributes.icon === undefined ? "" : `<qti-resource-icon>${attributes.icon}</qti-resource-icon>`;
  return `<qti-digital-material${label}${mimeType}><qti-file-href>${escaped(href)}</qti-file-href>${icon}</qti-digital-material>`;
}

/** The elements of the companion materials of an item, as XML; physical materials as text. */
export interface Materials {
  readonly calculators?: readonly string[];
  readonly rules?: readonly string[];
  readonly protractors?: readonly string[];
  readonly digital?: readonly string[];
  readonly physical?: readonly string[];
}

/** Reads the companion materials that the given elements make, with the runtime, as the player gets them. */
export function companion({
  calculators = [],
  rules = [],
  protractors = [],
  digital = [],
  physical = [],
}: Materials = {}): CompanionMaterialsInfo {
  const content = [
    ...calculators,
    ...rules,
    ...protractors,
    ...digital,
    ...physical.map((text) => `<qti-physical-material>${escaped(text)}</qti-physical-material>`),
  ].join("");
  const document = readAsi(
    `<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="i" title="t" time-dependent="false"><qti-companion-materials-info>${content}</qti-companion-materials-info></qti-assessment-item>`,
  );
  if (document.kind !== "item" || document.item.companionMaterials === undefined) {
    throw new Error("The fixture has no companion materials.");
  }
  return document.item.companionMaterials;
}
