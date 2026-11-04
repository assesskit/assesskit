import type { BodyNode, ModalFeedback, TestFeedback } from "@assesskit/runtime/asi";
import type { CandidateView } from "@assesskit/runtime/delivery/wire";
import type { ViewDocuments } from "../../protocol/index.js";
import type { RootContent } from "../roots/index.js";

/**
 * Makes the body of feedback of resolved nodes.
 *
 * @remarks
 * The nodes come from the feedback the engine resolved, whose schema holds the flow content of feedback and no
 * interaction; the type of the view says only that they are content.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, modal feedback}
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

/**
 * Wraps resolved nodes as the modal feedback a content root shows in a dialog.
 *
 * @param nodes - The resolved nodes.
 * @returns The feedback.
 */
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
 * Builds what a content root shows for a view: the rubric and the test feedback against the test's document, the item with
 * its stimuli against theirs, and the stylesheets of the test, then those of the item.
 *
 * @remarks
 * Nothing is decided here; the engine resolved the content.
 *
 * @param view - The view.
 * @param documents - The paths of the documents of the view.
 * @returns The content.
 */
export function rootContentOf(view: CandidateView, documents: ViewDocuments): RootContent {
  const { current } = view;
  const stylesheets = [...new Set([...view.test.stylesheets, ...(current?.stylesheets ?? [])])];
  return {
    ...(stylesheets.length === 0 ? {} : { stylesheets }),
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
          catalogs: current.catalogs,
          hazards: current.hazards,
          ...((current.variant?.language ?? current.language) === undefined
            ? {}
            : { language: current.variant?.language ?? current.language }),
        }),
  };
}
