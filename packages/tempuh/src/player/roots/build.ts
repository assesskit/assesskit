import type { TestFeedback } from "@luthfanwakan/olah/asi";
import type { Messages } from "../../messages/index.js";
import { type BodyRenderer, type BodyRendererOptions, createBodyRenderer } from "../content/index.js";
import { html } from "../dom.js";
import { renderFeedback } from "../feedback/index.js";
import type { ContentPart, RootContent } from "./content.js";
import { hazardNotice, remainingHazards } from "./hazards.js";

/** Builds the region of the test feedback, which a screen reader finds by its name. */
function feedbackRegion(feedback: readonly TestFeedback[], renderer: BodyRenderer, messages: Messages): HTMLElement {
  return html(
    "section",
    { class: "tempuh-test-feedback", "aria-label": messages.feedbackTitle },
    ...feedback.map((entry) => renderFeedback(entry, "h2", renderer)),
  );
}

/** The element that holds the content of a root, and the renderer of its item. */
export interface BuiltContent {
  /** The element for the shadow root. */
  readonly container: HTMLElement;
  /** The renderer of the item's body, which renders its cards and feedback too. */
  readonly renderer: BodyRenderer;
}

/**
 * Builds the DOM of a root's content, in the order the candidate meets it: the notice of the hazards that remain, the
 * rubric, the stimuli beside the item, and the test feedback. Each part is rendered from its own base, so that its
 * relative references resolve against its own document.
 */
export function buildContent(
  content: RootContent,
  options: Omit<BodyRendererOptions, "base" | "withholdMedia" | "variables">,
): BuiltContent {
  const { rubric, stimuli = [], body, testFeedback = [], hazards = [], language, variables } = content;
  const remaining = remainingHazards(hazards);
  const rendererFor = (part: ContentPart | undefined): BodyRenderer =>
    createBodyRenderer({ ...options, base: part?.base ?? "", withholdMedia: remaining.length > 0, variables });
  const render = (part: ContentPart | undefined): Node[] => rendererFor(part).nodes(part?.nodes ?? []);
  const renderer = rendererFor(body);
  const main = html(
    "div",
    { class: "tempuh-main" },
    html(
      "div",
      { class: "tempuh-stimuli" },
      ...stimuli.map((stimulus) => html("section", { class: "tempuh-stimulus" }, ...render(stimulus))),
    ),
    html("div", { class: "tempuh-body" }, ...renderer.nodes(body?.nodes ?? [])),
  );
  if (stimuli.length > 0) main.setAttribute("data-tempuh-stimuli", "");
  const container = html("div", { class: "tempuh-content" });
  if (language !== undefined) container.setAttribute("lang", language);
  if (remaining.length > 0) container.append(hazardNotice(remaining, options.messages));
  if (rubric !== undefined) container.append(html("div", { class: "tempuh-rubric" }, ...render(rubric)));
  container.append(main);
  if (testFeedback.length > 0) container.append(feedbackRegion(testFeedback, renderer, options.messages));
  return { container, renderer };
}
