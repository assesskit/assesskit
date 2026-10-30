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
 * | `reference` | a number, or the identifier of a variable that holds it; with `braced`, the identifier is written `{identifier}` (INFO §9.3.1) and a bare identifier reads too |
 */
export type AttributeType =
  | {
      /** Text. */
      readonly kind: "string";
      /** What the text means, when the schema says. */
      readonly format?: StringFormat;
    }
  | {
      /** `true` or `false`. */
      readonly kind: "boolean";
    }
  | {
      /** A safe integer. */
      readonly kind: "integer";
      /** The least value, when the schema bounds it. */
      readonly minimum?: number;
    }
  | {
      /** A number. */
      readonly kind: "double";
      /** The least value, when the schema bounds it. */
      readonly minimum?: number;
    }
  | {
      /** One of a list of terms. */
      readonly kind: "enum";
      /** The terms, in schema order. */
      readonly terms: readonly string[];
      /** Whether an `ext:` term is also valid. */
      readonly extension?: true;
    }
  | {
      /** Items separated by white space. */
      readonly kind: "list";
      /** The type of each item. */
      readonly item: AttributeType;
    }
  | {
      /** A number, or the identifier of a variable that holds it. */
      readonly kind: "reference";
      /** The base type of the number. */
      readonly value: "integer" | "double";
      /** The least value, when the schema bounds it. */
      readonly minimum?: number;
      /** Whether the identifier is written `{identifier}` (INFO §9.3.1). */
      readonly braced?: true;
    };

/**
 * The attributes or elements beyond its own that a type allows: of `any` namespace (for attributes, those in no
 * namespace too; for elements, the ASI namespace too) or of namespaces `other` than the ASI one. The reader and the
 * writer keep them as they are. A `strict` wildcard only accepts what a schema declares, so a generated document must
 * not use it.
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

/** An element of another namespace that a slot accepts: MathML or SSML, which the model keeps as XML. */
export interface ForeignDef {
  /** The namespace URI. */
  readonly namespace: string;
  /** The local name, such as `math`. */
  readonly element: string;
}

/** A place in the content of an element type where child elements go. */
export interface SlotDef {
  /** The property of the model; a slot that holds more than one element is an array. */
  readonly property: string;
  /** The elements of the ASI namespace the slot accepts. */
  readonly accepts: readonly AcceptDef[];
  /** The elements of other namespaces the slot accepts. */
  readonly foreign?: readonly ForeignDef[];
  /** Whether the slot also accepts `xi:include`, which the model keeps as an `XmlElement`. */
  readonly include?: true;
  /** Whether text may stand between the elements of the slot; otherwise only white space may. */
  readonly text?: true;
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
 * | `slots` | child elements in the slots, with text in a slot that takes it; a `wildcard` also allows other elements |
 */
export type ContentDef =
  | { readonly kind: "empty" }
  | { readonly kind: "text"; readonly value: AttributeType }
  | { readonly kind: "slots"; readonly slots: readonly SlotDef[]; readonly wildcard?: Wildcard };

/** An element type of the schema: its attributes and its content. */
export interface TypeDef {
  /**
   * The attributes of the types it extends, in schema order, before its own. The table gives them as one list that
   * many types share, so that the declaration file of the table names the list instead of repeating it.
   */
  readonly inherited?: readonly AttributeDef[];
  /** The attributes it adds, in schema order. */
  readonly attributes: readonly AttributeDef[];
  /** The attributes besides those of `attributes` that are allowed, if any. */
  readonly attributeWildcard?: Wildcard;
  /** What the type contains. */
  readonly content: ContentDef;
}
