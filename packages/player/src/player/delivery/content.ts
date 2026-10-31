import type { BodyNode, ModalFeedback, TestFeedback } from "@assesskit/runtime/asi";
import type { CandidateView } from "@assesskit/runtime/delivery";
import type { ViewDocuments } from "../../protocol/index.js";
import type { RootContent } from "../roots/index.js";

/**
 * The body of feedback made of resolved nodes. The nodes come from the feedback the engine resolved, whose schema holds
 * the flow content of feedback and no interaction (INFO §5.93); the type of the view says only that they are content.
 */
function feedbackBody<TBody extends ModalFeedback["contentBody"] | TestFeedback["contentBody"]>(
  nodes: readonly BodyNode[],
): TBody {
  return { kind: "content-body", children: nodes } as TBody;
}

/** Wraps resolved nodes as the test feedback a content root shows: the view has settled which feedback is visible, so the wrapper decides nothing. */
function testFeedbackOf(nodes: readonly BodyNode[], status: CandidateView["status"]): TestFeedback {
  return {
    kind: "test-feedback",
    access: status === "ended" ? "atEnd" : "during",
    outcomeIdentifier: "",
    showHide: "show",
    identifier: "",
    stylesheets: [],
    extensions: [],
    contentBody: feedbackBody(nodes),
  };
}

/** Wraps resolved nodes as the modal feedback a content root shows in a dialog. */
export function modalFeedbackOf(nodes: readonly BodyNode[]): ModalFeedback {
  return {
    kind: "modal-feedback",
    outcomeIdentifier: "",
    showHide: "show",
    identifier: "",
    stylesheets: [],
    extensions: [],
    contentBody: feedbackBody(nodes),
  };
}

/**
 * Builds what a content root shows for a view (the player design §2.5): the rubric and the test feedback against the test's
 * document, and the item with its stimuli against theirs. Nothing is decided here; the engine resolved the content.
 */
export function rootContentOf(view: CandidateView, documents: ViewDocuments): RootContent {
  const { current } = view;
  return {
    ...(view.rubric.length === 0 ? {} : { rubric: { nodes: view.rubric, base: documents.test } }),
    ...(view.testFeedback.length === 0 ? {} : { testFeedback: [testFeedbackOf(view.testFeedback, view.status)] }),
    ...(current === undefined
      ? {}
      : {
          stimuli: current.stimuli.map((stimulus, index) => ({
            nodes: stimulus.body,
            base: documents.stimuli[index] ?? "",
          })),
          body: { nodes: current.body, base: documents.item },
          stylesheets: current.stylesheets,
          catalogs: current.catalogs,
          hazards: current.hazards,
          ...((current.variant?.language ?? current.language) === undefined
            ? {}
            : { language: current.variant?.language ?? current.language }),
        }),
  };
}
