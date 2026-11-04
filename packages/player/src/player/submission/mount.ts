import type { BodyNode } from "@assesskit/runtime/asi";
import { describe } from "@assesskit/runtime/checks";
import type { View } from "@assesskit/runtime/content";
import { AssesskitError, DataError } from "@assesskit/runtime/errors";
import type { Submission } from "../../protocol/index.js";
import { checkSubmission } from "../../protocol/internal.js";
import { html, shadowRootOf } from "../internal.js";
import { type ContentRoot, createContentRoot } from "../roots/index.js";
import { buildSubmission } from "./build.js";
import { readSubmissionOptions, type SubmissionOptions, type SubmissionSettings } from "./options.js";
import { submissionStyleSheet } from "./styles.js";

/** A submission on show. */
export interface MountedSubmission {
  /**
   * Shows another submission in place of the one on show, as `mountSubmission` shows the first.
   *
   * @remarks
   * When it throws, the display shows what it showed before.
   *
   * @param submission - The submission to show.
   * @throws `DataError` when `submission` is not a submission, and a `DataError` of the runtime when a value of it is not a
   * wire value.
   */
  update(submission: Submission): void;
  /** Takes the display and its content roots down. The shadow root of the host stays, empty. */
  destroy(): void;
}

/** A submission has no item stylesheet to load, so the loader of the content roots is never called. */
const NO_STYLESHEETS = (): Promise<never> =>
  Promise.reject(new AssesskitError("A submission has no stylesheets to load."));

/** Creates the content root of one part of the display, shows the nodes in it, and records the root. */
function contentIn(
  roots: ContentRoot[],
  settings: SubmissionSettings,
): (nodes: readonly BodyNode[], view: View, base: string) => HTMLElement {
  return (nodes, view, base) => {
    const host = html("div", { class: "ak-submission-content" });
    const { messages, assets, origins, interactions, fileUrl, typesetter, stylesheet } = settings;
    const root = createContentRoot(host, {
      messages,
      assets,
      origins,
      interactions,
      view,
      stylesheet,
      fetch: NO_STYLESHEETS,
      ...(fileUrl === undefined ? {} : { fileUrl }),
      ...(typesetter === undefined ? {} : { typesetter }),
    });
    roots.push(root);
    root.show({ body: { nodes, base } }).catch((error: unknown) => {
      // A MathJax that cannot load leaves the expressions as MathML, which the browser renders: the
      // display is whole. Anything else is a defect and surfaces.
      if (error instanceof DataError || !(error instanceof AssesskitError)) throw error;
    });
    return host;
  };
}

/**
 * Shows a submission read-only to a rater: the outcome and who scores it, the rubric, and for each item the outcome
 * covers its body as the candidate saw it, the responses the outcome rates, the correct responses and the template values.
 *
 * @remarks
 * The display lives in a shadow root of `host`; each body and rubric is drawn by a content root in it, with the renderer of
 * the player. The rating form and the rating workflow are the host's. A submission holds the correct responses, so show it
 * only on a page that authorized raters reach.
 *
 * @param host - An element in the page that has no shadow root, or one that an earlier mount of the player left empty.
 * @param submission - What `buildSubmission` returned, as JSON parsed it.
 * @param options - See {@link SubmissionOptions}.
 * @returns The handle that shows another submission and takes the display down.
 * @throws `DataError` when `host` is not an element that can have a shadow root and has none, or has one that an earlier mount of the player left empty, an option is not of its
 * type, or `submission` is not a submission, and a `DataError` of the runtime when a value of it is not a wire value.
 */
export function mountSubmission(
  host: HTMLElement,
  submission: Submission,
  options: SubmissionOptions,
): MountedSubmission {
  if (!(host instanceof HTMLElement)) throw new DataError(`The host must be an element, found ${describe(host)}.`);
  const settings = readSubmissionOptions(options);

  /** Builds the display and its content roots without touching the page, so that a submission that fails leaves nothing. */
  const build = (next: unknown): { readonly display: HTMLElement; readonly roots: ContentRoot[] } => {
    checkSubmission(next);
    const roots: ContentRoot[] = [];
    try {
      return { display: buildSubmission(next, { ...settings, content: contentIn(roots, settings) }), roots };
    } catch (error) {
      for (const root of roots) root.destroy();
      throw error;
    }
  };

  const first = build(submission);
  let shadow: ShadowRoot;
  try {
    shadow = shadowRootOf(host);
  } catch (error) {
    for (const root of first.roots) root.destroy();
    throw error;
  }
  // A sheet of its own for each display: WebKit keeps the media queries of a sheet that no root has adopted as they were.
  shadow.adoptedStyleSheets = [settings.stylesheet, submissionStyleSheet()];
  shadow.replaceChildren(first.display);
  let shown = first.roots;
  return {
    update: (next) => {
      const { display, roots } = build(next);
      for (const root of shown) root.destroy();
      shown = roots;
      shadow.replaceChildren(display);
    },
    destroy: () => {
      for (const root of shown) root.destroy();
      shown = [];
      shadow.replaceChildren();
    },
  };
}
