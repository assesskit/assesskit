import type { ModalFeedback, TestFeedback } from "@assesskit/runtime/asi";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../dom.js";

/**
 * Renders the feedback that the view has resolved: a `qti-modal-feedback` or a `qti-test-feedback` with its title as a
 * heading of the given level and its content body (INFO §5.93, §5.157). Whether the feedback is shown is the engine's
 * decision (`visibleModalFeedback` and `visibleTestFeedback` of the runtime), so the renderer shows what it gets.
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
