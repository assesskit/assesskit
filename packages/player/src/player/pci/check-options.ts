import type { PortableCustomInteraction } from "@assesskit/runtime/asi";
import { DataError } from "@assesskit/runtime/errors";
import {
  checkArray,
  checkFunction,
  checkNonEmptyString,
  checkProperties,
  checkRecord,
  checkString,
  describe,
} from "../../checks.js";
import { checkPresentation } from "../presentation/internal.js";
import { checkVariable, type PciVariable } from "./files.js";
import type { PciFrameOptions } from "./options.js";
import type { PciStatus } from "./protocol.js";

const STATUSES: readonly PciStatus[] = ["interacting", "suspended", "closed", "solution", "review"];
/** Parses an absolute URL; `URL.canParse` is outside the browser baseline. */
function parseUrl(text: string): URL | undefined {
  try {
    return new URL(text);
  } catch {
    return undefined;
  }
}
function checkHttpUrl(value: unknown, label: string): asserts value is string {
  checkString(value, label);
  const url = parseUrl(value);
  if (url === undefined || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new DataError(`${label} must be an absolute http or https URL, found ${describe(value)}.`);
  }
}
function checkBaseUrl(value: unknown, label: string): asserts value is string {
  checkHttpUrl(value, label);
  if (!value.endsWith("/")) throw new DataError(`${label} must end in "/", found ${describe(value)}.`);
}
function checkOrigin(value: unknown): asserts value is string {
  checkHttpUrl(value, "An origin");
  if (new URL(value).origin !== value) {
    throw new DataError(
      `An origin must be a scheme, a host and a port only, such as "https://cdn.example", found ${describe(value)}.`,
    );
  }
}
function checkEach(value: unknown, message: string, check: (item: unknown) => void): void {
  checkArray(value, message);
  for (const item of value) check(item);
}
function checkMap(value: unknown, message: string): asserts value is ReadonlyMap<unknown, unknown> {
  if (!(value instanceof Map)) throw new DataError(`${message}, found ${describe(value)}.`);
}
function checkVariables(value: unknown, label: string): asserts value is ReadonlyMap<string, PciVariable> {
  checkMap(value, `${label} must be a Map`);
  for (const [name, variable] of value) {
    checkNonEmptyString(name, `A name in ${label}`);
    checkVariable(variable);
  }
}
function checkInteraction(value: unknown): asserts value is PortableCustomInteraction {
  checkRecord(value, "The option interaction must be an object");
  if (value.kind !== "portable-custom-interaction") {
    throw new DataError(
      `The option interaction must be a qti-portable-custom-interaction, found the kind ${describe(value.kind)}.`,
    );
  }
  checkNonEmptyString(
    value.customInteractionTypeIdentifier,
    "The custom-interaction-type-identifier of the interaction",
  );
  checkNonEmptyString(value.responseIdentifier, "The response-identifier of the interaction");
}
/**
 * Checks the options of {@link mountPciFrame}, as a host passes them from JavaScript.
 *
 * @param options - The value to check.
 * @throws `DataError` when an option is missing, has the wrong type, or is a URL or an origin that is not one, or a variable
 * does not have its declared cardinality and base type.
 */
export function checkPciFrameOptions(options: unknown): asserts options is PciFrameOptions {
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", [
    "staticUrl",
    "origins",
    "messages",
    "language",
    "interaction",
    "configuration",
    "assets",
    "prompt",
    "markup",
    "stylesheets",
    "status",
    "state",
    "presentation",
    "response",
    "templateVariables",
    "contextVariables",
    "files",
    "onEvent",
  ]);
  const { staticUrl, origins = [], messages, language, prompt, markup, stylesheets, state = null } = options;
  const { templateVariables = new Map(), contextVariables = new Map() } = options;
  checkBaseUrl(staticUrl, "The option staticUrl");
  checkEach(origins, "The option origins must be an array", checkOrigin);
  checkRecord(messages, "The option messages must be an object");
  checkNonEmptyString(messages.interactiveQuestion, "The message interactiveQuestion");
  checkNonEmptyString(language, "The option language");
  checkInteraction(options.interaction);
  checkRecord(options.configuration, "The option configuration must be an object");
  checkFunction(options.assets, "The option assets must be a function");
  if (prompt !== null) checkString(prompt, "The option prompt");
  checkString(markup, "The option markup");
  checkEach(stylesheets, "The option stylesheets must be an array", (url) =>
    checkHttpUrl(url, "A stylesheet of the option stylesheets"),
  );
  if (!STATUSES.some((status) => status === options.status)) {
    throw new DataError(
      `The option status must be "interacting", "suspended", "closed", "solution" or "review", found ${describe(options.status)}.`,
    );
  }
  if (state !== null) checkString(state, "The option state");
  if (options.presentation !== undefined) checkPresentation(options.presentation, "The option presentation");
  checkVariable(options.response);
  checkVariables(templateVariables, "The option templateVariables");
  checkVariables(contextVariables, "The option contextVariables");
  checkRecord(options.files, "The option files must be an object with the functions read and upload");
  checkFunction(options.files.read, "The function read of the option files must be a function");
  checkFunction(options.files.upload, "The function upload of the option files must be a function");
  checkFunction(options.onEvent, "The option onEvent must be a function");
}
