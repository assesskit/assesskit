import type { InteractionDescriptor } from "@assesskit/runtime/interactions";
import { numericRecord } from "@assesskit/runtime/interactions";
import {
  type BaseType,
  container,
  normalizeValue,
  type Primitive,
  single,
  type Value,
} from "@assesskit/runtime/values";
import type { Messages } from "../../messages/index.js";
import { InteractionElement, sameValue } from "./element.js";
import { primitivesOf } from "./values.js";

/** The number base of a text that the item does not give a base for (INFO §5.162.2). */
const DECIMAL = 10;

/** What is wrong with a text that should be a number: it is none, or it has a fraction where a whole number is needed. */
export type TextProblem = "integer" | "number";

/** The response that texts give, and what is wrong with them where they should be numbers. */
interface TextResponse {
  /** The value, `null` for NULL. */
  readonly value: Value | null;
  /** What the candidate should fix, if a text is not a number of the base type. */
  readonly problem?: TextProblem;
}

/** A field in which the candidate types a text. */
export interface TextField {
  /** The text in the field. */
  text: string;
  /** Whether the candidate cannot change the text. */
  locked: boolean;
}

/** The field of an `input` or a `textarea`. A locked field is read-only, so that it keeps the focus and can be read. */
export class ControlField implements TextField {
  readonly control: HTMLInputElement | HTMLTextAreaElement;

  /** @param control - The control that the candidate types in. */
  constructor(control: HTMLInputElement | HTMLTextAreaElement) {
    this.control = control;
  }

  get text(): string {
    return this.control.value;
  }

  set text(text: string) {
    this.control.value = text;
  }

  get locked(): boolean {
    return this.control.readOnly;
  }

  set locked(locked: boolean) {
    this.control.readOnly = locked;
  }
}

/** Reads a text for a base type: a string as it is, a number from the runtime's numeric record (INFO §2.4.2.2). */
function primitiveOf(baseType: BaseType, text: string, base: number): { primitive?: Primitive; problem?: TextProblem } {
  if (baseType !== "integer" && baseType !== "float") return text === "" ? {} : { primitive: text };
  if (text.trim() === "") return {};
  const fields = numericRecord(text, base)?.fields;
  const number = fields?.get(baseType === "integer" ? "integerValue" : "floatValue")?.value;
  if (typeof number === "number") return { primitive: number };
  return { problem: fields?.has("floatValue") ? "integer" : "number" };
}

/**
 * Returns the response for the texts that the candidate typed, as the declaration of the response variable asks: the
 * strings, the numbers that they read as, or the record of the runtime's `numericRecord` (INFO §2.4.2.2, §2.4.2.3). Texts that
 * are empty are NULL.
 */
function responseOfTexts(descriptor: InteractionDescriptor, texts: readonly string[]): TextResponse {
  const cardinality = descriptor.declaration?.cardinality ?? "single";
  const baseType = descriptor.declaration?.baseType ?? "string";
  const base = descriptor.constraints.base ?? DECIMAL;
  if (cardinality === "record") return { value: numericRecord(texts[0] ?? "", base) };
  const read = texts.map((text) => primitiveOf(baseType, text, base));
  const primitives = read.flatMap(({ primitive }) => (primitive === undefined ? [] : [primitive]));
  const problem = read.find((item) => item.problem !== undefined)?.problem;
  const [first] = primitives;
  const value =
    cardinality === "single"
      ? first === undefined
        ? null
        : single(baseType, first)
      : container(cardinality, baseType, primitives);
  return problem === undefined ? { value } : { value, problem };
}

/** Returns the text of one primitive, in the number base of the interaction. */
const textOfPrimitive = (primitive: Primitive, base: number): string =>
  typeof primitive === "number" ? primitive.toString(base) : typeof primitive === "string" ? primitive : "";

/**
 * Returns the texts to show for a response: those of its strings or numbers, or the text as typed where the item keeps it
 * in a second variable (INFO §5.162.3), which wins over the number it was read as.
 */
function textsOfResponse(descriptor: InteractionDescriptor, value: Value | null, typed: Value | null): string[] {
  const base = descriptor.constraints.base ?? DECIMAL;
  const [first] = primitivesOf(typed);
  if (typeof first === "string") return [first];
  if (value?.cardinality === "record") {
    const text = value.fields.get("stringValue")?.value;
    return typeof text === "string" ? [text] : [];
  }
  return primitivesOf(value).map((primitive) => textOfPrimitive(primitive, base));
}

/**
 * The element of an interaction whose response is the text that the candidate types: a text entry or an extended text.
 * It also keeps the text as typed, for the item that binds a number and wants the text too (`string-identifier`).
 */
export abstract class TextElement extends InteractionElement {
  #typed: Value | null = null;
  #problem: TextProblem | undefined;
  /** The text as typed, from the variable that `string-identifier` names; `null` for NULL. */
  get typed(): Value | null {
    return this.#typed;
  }

  /**
   * @throws `DataError` when the value is neither NULL nor a value of the runtime.
   */
  set typed(typed: Value | null) {
    const next = typed === null ? null : normalizeValue(typed);
    if (sameValue(this.#typed, next)) return;
    this.#typed = next;
    this.refresh();
  }

  /** Returns the fields in which the candidate types, in order. */
  protected abstract fields(): readonly TextField[];

  protected override sync(descriptor: InteractionDescriptor, _messages: Messages): void {
    const fields = this.fields();
    for (const field of fields) field.locked = this.disabled;
    // The fields keep what the candidate typed while it still gives the response: "3.50" stays when the host sends 3.5.
    const typed = fields.map(({ text }) => text);
    const [asTyped] = primitivesOf(this.#typed);
    const unchanged =
      sameValue(responseOfTexts(descriptor, typed).value, this.value) &&
      (asTyped === undefined || asTyped === typed[0]);
    if (unchanged) return;
    const texts = textsOfResponse(descriptor, this.value, this.#typed);
    fields.forEach((field, index) => {
      field.text = texts[index] ?? "";
    });
  }

  protected override extraHints(messages: Messages): readonly string[] {
    if (this.#problem === undefined) return [];
    return [this.#problem === "integer" ? messages.hintInteger : messages.hintNumber];
  }

  /** Gives the response for the texts in the fields: the value, and the text as typed where the item asks for it. */
  protected typedIn(): void {
    const descriptor = this.descriptor;
    if (descriptor === undefined) return;
    const texts = this.fields().map(({ text }) => text);
    const { value, problem } = responseOfTexts(descriptor, texts);
    this.#problem = problem;
    const { stringIdentifier } = descriptor;
    this.#typed = stringIdentifier === undefined ? null : single("string", texts[0] ?? "");
    this.respond(value);
    if (stringIdentifier !== undefined) this.respond(this.#typed, stringIdentifier);
  }
}
