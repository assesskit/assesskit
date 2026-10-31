/** The namespace of PNP documents, the target namespace of the PNP schema. */
export const PNP_NAMESPACE = "http://www.imsglobal.org/xsd/qti/qtiv3p0/imsafa3p0pnp_v1p0";

/**
 * The two other namespaces that 1EdTech's own documents give PNP elements: the examples of the best practices guide and
 * the XML binding. A reader accepts them; a writer never writes them, and `assesskit validate` reports them as errors.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps, namespaces of the samples}
 */
export const PNP_ALTERNATE_NAMESPACES: readonly string[] = [
  "http://www.imsglobal.org/xsd/qtiv3p0/imsafa3p0pnp_v1p0",
  "http://www.imsglobal.org/xsd/qt/qtiv3p0/imsafa3p0pnp_v1p0",
];

/** The address of the PNP schema, which a written document names in `xsi:schemaLocation` as the examples of the best practices guide do. */
export const PNP_SCHEMA_LOCATION = "https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqtiv3p0_afa3p0pnp_v1p0.xsd";
