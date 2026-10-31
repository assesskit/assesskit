/**
 * The JSON of a value in the binding of the best practices guide: `{ "base": ... }` for a single value,
 * `{ "list": ... }` for a `multiple` or `ordered` container and `{ "record": ... }` for a record.
 *
 * @remarks
 * A NULL has `null` in place of the content. The JSON does not name the cardinality of a container or the base type of a
 * NULL, so reading it needs a {@link ValueDeclaration}.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, JSON binding}
 */
export type JsonValue =
  | {
      /** The content of a single value: `{ "<base type>": ... }`, or `null`. */
      readonly base: unknown;
    }
  | {
      /** The content of a container: `{ "<base type>": [...] }`, or `null`. */
      readonly list: unknown;
    }
  | {
      /** The fields of a record: `[{ "name": ..., "base": ... }, ...]`, or `null`. */
      readonly record: unknown;
    };
