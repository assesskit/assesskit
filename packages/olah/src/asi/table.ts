/**
 * A format of the text of a string, which says what values are valid; the reader does not check it.
 *
 * | Format | Text |
 * | --- | --- |
 * | `identifier` | an identifier (INFO §4.1.1) |
 * | `id`, `idref` | an identifier that is unique in the document, and one that refers to such an identifier |
 * | `mime-type` | a MIME type, such as `image/png` |
 * | `coords` | the coordinates of a shape, such as `10,20,5` |
 * | `length` | a number with an optional `%` |
 * | `decimal` | a decimal number |
 * | `uri` | a URI reference, such as `images/a.png` |
 * | `language` | a language tag, such as `en-US` |
 */
export type StringFormat =
  | "coords"
  | "decimal"
  | "id"
  | "idref"
  | "identifier"
  | "language"
  | "length"
  | "mime-type"
  | "uri";

/**
 * How the text of an attribute, or of an element with text content, is read and written.
 *
 * | Kind | Value in the model |
 * | --- | --- |
 * | `string` | the text as written |
 * | `boolean` | `true` or `false` |
 * | `integer` | a safe integer |
 * | `double` | a number, with `INF`, `-INF` and `NaN` |
 * | `enum` | one of `terms`, or an `ext:` term when `extension` is set |
 * | `list` | the items, separated by white space in the text |
 * | `reference` | a number, or the identifier of a variable that holds it |
 */
export type AttributeType =
  | { readonly kind: "string"; readonly format?: StringFormat }
  | { readonly kind: "boolean" }
  | { readonly kind: "integer"; readonly minimum?: number }
  | { readonly kind: "double"; readonly minimum?: number }
  | { readonly kind: "enum"; readonly terms: readonly string[]; readonly extension?: true }
  | { readonly kind: "list"; readonly item: AttributeType }
  | { readonly kind: "reference"; readonly value: "integer" | "double"; readonly minimum?: number };

/**
 * The attributes or elements beyond its own that a type allows: of `any` namespace (attributes only: those in no
 * namespace too) or of namespaces `other` than the ASI one. The reader and the writer keep them as they are. A `strict`
 * wildcard only accepts what a schema declares, so a generated document must not use it.
 */
export interface Wildcard {
  /** Which namespaces the wildcard allows. */
  readonly namespaces: "any" | "other";
  /** Whether the schema demands a declaration for what the wildcard matches. */
  readonly strict?: true;
}

/** An attribute of an element type. */
export interface AttributeDef {
  /** The name as written in a document, such as `max-attempts` or `xml:lang`. */
  readonly name: string;
  /** The property of the model. */
  readonly property: string;
  /** Whether a document must give the attribute. */
  readonly use: "required" | "optional";
  /** The default of the schema as written; readers leave an omitted attribute omitted. */
  readonly default?: string;
  /** How the text is read and written. */
  readonly type: AttributeType;
}

/** An element that a slot accepts, with the name of its type in the table. */
export interface AcceptDef {
  /** The element name, such as `qti-and`. */
  readonly element: string;
  /** The type of the element. */
  readonly type: string;
}

/** A place in the content of an element type where child elements go. */
export interface SlotDef {
  /** The property of the model; a slot that holds more than one element is an array. */
  readonly property: string;
  /** The elements the slot accepts. */
  readonly accepts: readonly AcceptDef[];
  /** Whether the slot also accepts `xi:include`, which the model keeps as an `XmlElement`. */
  readonly include?: true;
  /** The fewest elements. */
  readonly min: number;
  /** The most elements. */
  readonly max: number | "unbounded";
  /** The properties of the slots that cannot be used together with this one. */
  readonly excludes?: readonly string[];
}

/**
 * What an element type contains.
 *
 * | Kind | Content |
 * | --- | --- |
 * | `empty` | nothing |
 * | `text` | text only, of the type `value` |
 * | `flow` | text mixed with HTML, MathML and SSML elements, which the model keeps as XML nodes |
 * | `slots` | child elements in the slots; a `wildcard` also allows elements of other namespaces |
 */
export type ContentDef =
  | { readonly kind: "empty" }
  | { readonly kind: "text"; readonly value: AttributeType }
  | { readonly kind: "flow" }
  | { readonly kind: "slots"; readonly slots: readonly SlotDef[]; readonly wildcard?: Wildcard };

/** An element type of the schema: its attributes and its content. */
export interface TypeDef {
  /** The attributes in schema order, those of the types it extends first. */
  readonly attributes: readonly AttributeDef[];
  /** The attributes besides those of `attributes` that are allowed, if any. */
  readonly attributeWildcard?: Wildcard;
  /** What the type contains. */
  readonly content: ContentDef;
}
