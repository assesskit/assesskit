import type { XmlElement } from "../xml/index.js";
import { XSI_NAMESPACE } from "../xml/internal.js";
import { SCHEMA_FILES, type SchemaFile } from "./schema-files.js";

/**
 * The schema of each namespace a document can have at its root: the primary schema that validates every document of
 * the namespace.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, schemas}
 */
export const PRIMARY_SCHEMAS: ReadonlyMap<string, string> = new Map([
  ["http://www.imsglobal.org/xsd/imsqtiasi_v3p0", "imsqti_asiv3p0p1_v1p0.xsd"],
  ["http://www.imsglobal.org/xsd/imsqti_result_v3p0", "imsqti_resultv3p0_v1p0.xsd"],
  ["http://www.imsglobal.org/xsd/imsqti_usagedata_v3p0", "imsqti_usagedatav3p0_v1p0.xsd"],
  ["http://www.imsglobal.org/xsd/imsqti_metadata_v3p0", "imsqti_metadatav3p0_v1p0.xsd"],
  ["http://ltsc.ieee.org/xsd/LOM", "imsmd_loose_v1p3p2.xsd"],
  ["http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1", "imsqtiv3p0_imscpv1p2_v1p0.xsd"],
  ["http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_extensionv1p2", "imsqtiv3p0_cpextv1p2_v1p0.xsd"],
  ["http://www.imsglobal.org/xsd/qti/qtiv3p0/imscsmd_v1p1", "imsqtiv3p0_csmv1p1_v1p0.xsd"],
  ["http://www.imsglobal.org/xsd/qti/qtiv3p0/imsafa3p0drd_v1p0", "imsqtiv3p0_afa3p0drd_v1p0.xsd"],
  ["http://www.imsglobal.org/xsd/qti/qtiv3p0/imsafa3p0pnp_v1p0", "imsqtiv3p0_afa3p0pnp_v1p0.xsd"],
]);

const SCHEMAS_BY_URL: ReadonlyMap<string, SchemaFile> = new Map(SCHEMA_FILES.map((schema) => [schema.url, schema]));
const SCHEMAS_BY_FILE: ReadonlyMap<string, SchemaFile> = new Map(SCHEMA_FILES.map((schema) => [schema.file, schema]));

/**
 * Returns the schema that the root element's own `xsi:schemaLocation` names for the root's namespace, when it is one of
 * the pinned schemas. It selects the 3.0.0 schema or a single-document schema.
 *
 * @see {@link https://www.w3.org/TR/xmlschema-1/ | XML Schema Part 1, schema-related markup in documents being validated}
 */
function hintedSchema(root: XmlElement): SchemaFile | undefined {
  const hint = root.attributes.find(({ namespace, name }) => namespace === XSI_NAMESPACE && name === "schemaLocation");
  const tokens = hint?.value.split(/[ \t\r\n]+/).filter((token) => token !== "") ?? [];
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    if (tokens[index] === root.namespace) return SCHEMAS_BY_URL.get(tokens[index + 1] ?? "");
  }
  return undefined;
}

/**
 * Returns the schema a document validates against: the pinned schema its `xsi:schemaLocation` names for the namespace
 * of its root, otherwise the primary schema of that namespace; `undefined` when the runtime has none.
 *
 * @param root - The root element of the document.
 * @returns The schema file, or `undefined` when the namespace of the root has none.
 */
export function selectSchema(root: XmlElement): SchemaFile | undefined {
  const primary = PRIMARY_SCHEMAS.get(root.namespace);
  return hintedSchema(root) ?? (primary === undefined ? undefined : SCHEMAS_BY_FILE.get(primary));
}
