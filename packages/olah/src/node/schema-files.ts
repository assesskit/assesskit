import schemaFiles from "./schema-files.json" with { type: "json" };

/** A schema that olah validates against: where it is published, the file name it is stored under and its hash. */
export interface SchemaFile {
  /** The address of the schema, which the schemas that import it name in their `schemaLocation`. */
  readonly url: string;
  /** The file name in the directory of a {@link SchemaSet}. */
  readonly file: string;
  /** The SHA-256 of the file as lowercase hexadecimal. */
  readonly sha256: string;
}

/**
 * The schemas that olah validates against, pinned by SHA-256: the ASI schema in 3.0.1 and 3.0.0 and its single-document
 * variants, Results Reporting, usage data, QTI metadata, LOM, the content package schema and its extensions, the
 * curriculum standards, accessibility resource and PNP schemas, and the XML, XInclude, XLink, MathML and SSML
 * schemas they import (BPIG §1.1.5). olah does not ship them: download each `url` into one directory under its `file`
 * name and check the hash.
 */
export const SCHEMA_FILES: readonly SchemaFile[] = schemaFiles;
