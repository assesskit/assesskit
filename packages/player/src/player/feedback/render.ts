import type { ModalFeedback, TestFeedback } from "@assesskit/runtime/asi";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../internal.js";

/**
 * Renders feedback that the view has resolved: a `qti-modal-feedback` or a `qti-test-feedback`.
 *
 * @remarks
 * The title is a heading of the given level and the content is the body. Whether the feedback is shown is the engine's
 * decision (`selectModalFeedback` and `selectTestFeedback` of the runtime), so the renderer shows what it gets.
 *
 * @param feedback - The feedback to render.
 * @param heading - The level of the heading that holds the title.
 * @param renderer - The renderer of content.
 * @returns The element that holds the heading and the body.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, feedback}
 */
export function renderFeedback(
  feedback: ModalFeedback | TestFeedback,
  heading: "h2" | "h3",
  renderer: BodyRenderer,
): Element {
  const name = feedback.kind === "modal-feedback" ? "qti-modal-feedback" : "qti-test-feedback";
  const title = feedback.title === undefined ? [] : [html(heading, {}, feedback.title)];
  return renderer.element(name, feedback, [...title, ...renderer.nodes(feedback.contentBody?.children ?? [])]);
}
