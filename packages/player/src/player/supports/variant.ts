import { checkNonEmptyString, checkProperties, checkRecord, describe } from "@assesskit/runtime/checks";
import type { VariantView } from "@assesskit/runtime/delivery/wire";
import { DataError } from "@assesskit/runtime/errors";
import type { Messages } from "../../messages/index.js";
import { checkMessages } from "../../messages/internal.js";
import { html } from "../internal.js";
import { adoptSupportStyles } from "./styles.js";

/** The options of {@link mountVariantNotice}. */
export interface VariantNoticeOptions {
  /** The text of the interface. */
  readonly messages: Messages;
  /** The language of the interface, a BCP 47 tag, in which the language of the variant is named. */
  readonly language: string;
}

/** The notice of the variant of a question that is shown. */
export interface VariantNotice {
  /**
   * Shows the variant that the runtime delivered, or nothing when the question itself is delivered.
   *
   * @remarks
   * A variant with a language is announced by the name of its language, which stands in the language it names; one without
   * says only that an adapted version is shown.
   *
   * @param variant - The variant of the item, or `undefined` for the question itself.
   * @throws `DataError` when `variant` is neither `undefined` nor a variant of the runtime's view.
   * @see {@link https://www.w3.org/TR/WCAG22/#language-of-parts | WCAG 2.2, language of parts}
   */
  update(variant: VariantView | undefined): void;
  /** Takes the notice away. */
  destroy(): void;
}

/**
 * Returns the name of a language in a language of the interface, or the tag when the browser has no name for it.
 *
 * @see {@link https://tc39.es/ecma402/#intl-displaynames-objects | ECMA-402, Intl.DisplayNames}
 */
function languageName(tag: string, interfaceLanguage: string): string {
  try {
    return new Intl.DisplayNames([interfaceLanguage], { type: "language" }).of(tag) ?? tag;
  } catch (error) {
    // A tag that is not well formed has no name.
    if (error instanceof RangeError) return tag;
    throw error;
  }
}

function checkVariantOptions(host: unknown, options: unknown): asserts options is VariantNoticeOptions {
  if (!(host instanceof HTMLElement && host.isConnected)) {
    throw new DataError(`The host must be an element in a document, found ${describe(host)}.`);
  }
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", ["messages", "language"]);
  checkMessages(options.messages);
  checkNonEmptyString(options.language, "The option language");
}

/**
 * Mounts the notice of the variant of a question.
 *
 * @remarks
 * The runtime chooses the variant at the first presentation, from the candidate's hazards and translation, and fixes it
 * for the session; the notice only says which one the candidate has, from `CandidateItem.variant`.
 *
 * @param host - The element that gets the notice, in a document or a shadow root.
 * @param options - See {@link VariantNoticeOptions}.
 * @returns The handle that updates the notice and takes it away.
 * @throws `DataError` when `host` or an option is not valid.
 */
export function mountVariantNotice(host: HTMLElement, options: VariantNoticeOptions): VariantNotice {
  checkVariantOptions(host, options);
  const { messages, language } = options;
  const release = adoptSupportStyles(host);
  const notice = html("p", { class: "ak-variant", role: "note" });
  notice.hidden = true;
  host.append(notice);
  return {
    update(variant) {
      if (variant === undefined) {
        notice.hidden = true;
        notice.replaceChildren();
        return;
      }
      checkRecord(variant, "The variant must be an object");
      if (variant.language !== undefined) checkNonEmptyString(variant.language, "The language of the variant");
      notice.replaceChildren(
        ...(variant.language === undefined
          ? [messages.variantAdapted]
          : [
              `${messages.variantLanguage}: `,
              html("span", { lang: variant.language }, languageName(variant.language, language)),
            ]),
      );
      notice.hidden = false;
    },
    destroy() {
      notice.remove();
      release();
    },
  };
}
