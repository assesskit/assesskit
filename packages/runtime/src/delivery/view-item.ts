import type { AssessmentItem, BodyNode, Catalog } from "../asi/index.js";
import { withDescendants } from "../asi/internal.js";
import { hazardExposure, resolveContent, visibleModalFeedback } from "../content/index.js";
import type { InteractionDescriptor } from "../interactions/index.js";
import { type LtiLink, resolveReference } from "../package/index.js";
import type { Value } from "../values/index.js";
import { attemptsOf, DEFAULT_MAX_ATTEMPTS, isAdaptive } from "./attempt.js";
import type { CandidateItem, LtiView, PciView, VariantView } from "./candidate-view.js";
import { type CourseItem, candidateOf, candidateTitle } from "./course.js";
import type { DeliveredItem, DeliveryState } from "./delivery-state.js";
import { itemFeedback, itemResponses, presentedInteractions } from "./item-display.js";
import { arrangeChoices, catalogsIn, portableInteractionsIn } from "./view-body.js";

/** Returns the package path of a reference as the document at `base` writes it; a reference outside the package stays as written. */
const packagePath = (base: string, href: string): string => resolveReference(base, href) ?? href;

/** Returns the identifiers of the response variables that the interactions bind, with those that keep a raw text. */
function responseIdentifiers(interactions: readonly InteractionDescriptor[]): ReadonlySet<string> {
  return new Set(
    interactions.flatMap(({ responseIdentifier, stringIdentifier }) =>
      stringIdentifier === undefined ? [responseIdentifier] : [responseIdentifier, stringIdentifier],
    ),
  );
}

/**
 * Returns the value of the attempts left including the open one; none when the item allows any number.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function attemptsLeft(item: AssessmentItem, maxAttempts: number | undefined, counted: number): number | undefined {
  const most = maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  return isAdaptive(item) || most === 0 ? undefined : Math.max(0, most - counted);
}

/** Returns each catalog once, by its `id`, in the order given. */
function distinctCatalogs(catalogs: readonly Catalog[]): Catalog[] {
  return [...new Map(catalogs.map((catalog) => [catalog.id, catalog])).values()];
}

/** Returns the template and context values that the interactions pass to their modules, by response identifier. */
function pciViews(body: readonly BodyNode[], delivered: DeliveredItem): ReadonlyMap<string, PciView> {
  const { variables, pciStates } = delivered.session;
  return new Map(
    portableInteractionsIn(body).map((interaction) => {
      const state = pciStates.get(interaction.responseIdentifier);
      const view: PciView = {
        templateValues: new Map<string, Value | null>(
          interaction.templateVariables.map(({ templateIdentifier }) => [
            templateIdentifier,
            variables.templates.get(templateIdentifier) ?? null,
          ]),
        ),
        contextValues: new Map<string, Value | null>(
          interaction.contextVariables.map(({ identifier }) => [
            identifier,
            variables.contexts.get(identifier) ?? null,
          ]),
        ),
        ...(state === undefined ? {} : { state }),
      };
      return [interaction.responseIdentifier, view];
    }),
  );
}

/** Returns the link to a tool as the candidate sees it. */
function ltiViewOf(link: LtiLink): LtiView {
  return {
    title: link.title,
    ...(link.description === undefined ? {} : { description: link.description }),
    ...(link.launchUrl === undefined ? {} : { launchUrl: link.launchUrl }),
    ...(link.secureLaunchUrl === undefined ? {} : { secureLaunchUrl: link.secureLaunchUrl }),
    custom: new Map(link.custom),
  };
}

/** Returns the variant presented in place of the item, with the language of its adaptation when it has one. */
function variantViewOf(resource: string, language: string | undefined): VariantView {
  return { resource, ...(language === undefined ? {} : { language }) };
}

/**
 * Builds what the candidate sees of the item instance presented.
 *
 * @remarks
 * Every field is built from the parts of the session and the item that the candidate may see, named one by one: the
 * item's answer keys, mappings and processing, the template and outcome values, and the content that the variables hide
 * are not read into the view. The correct responses are read only in the solution state.
 */
export function candidateItem(state: DeliveryState, delivered: DeliveredItem, entry: CourseItem): CandidateItem {
  const { session } = delivered;
  const candidate = candidateOf(entry, delivered.variant);
  const { item } = candidate;
  const { control } = entry;
  const feedback = itemFeedback(session, item, control);
  const variables = { outcomes: feedback.outcomes, templates: session.variables.templates };
  const resolve = (nodes: readonly BodyNode[]): readonly BodyNode[] =>
    resolveContent(nodes, variables, item, { view: "candidate" });
  const body = arrangeChoices(resolve(item.body?.children ?? []), session.choiceOrders);
  const stimuli = candidate.stimuli.map(({ stimulus }) => ({
    identifier: stimulus.identifier,
    body: resolve(stimulus.body.children),
  }));
  const shownModals = feedback.modal ? visibleModalFeedback(item, feedback.outcomes) : [];
  const modalFeedback = resolve(shownModals.flatMap((modal) => modal.contentBody?.children ?? []));
  const interactions = presentedInteractions(session, item, control);
  const bound = responseIdentifiers(interactions);
  const responses = new Map([...itemResponses(session)].filter(([identifier]) => bound.has(identifier)));
  const catalogs = distinctCatalogs([
    ...(item.catalogInfo?.catalogs ?? []),
    ...candidate.stimuli.flatMap(({ stimulus }) => stimulus.catalogInfo?.catalogs ?? []),
    ...catalogsIn([...body, ...stimuli.flatMap((each) => each.body), ...withDescendants(shownModals)]),
  ]);
  const stylesheets = [
    ...item.stylesheets.map(({ href }) => packagePath(candidate.path ?? "", href)),
    ...candidate.stimuli.flatMap(({ stimulus, path }) =>
      stimulus.stylesheets.map(({ href }) => packagePath(path ?? "", href)),
    ),
  ];
  const left = attemptsLeft(item, control.maxAttempts, session.countedAttempts);
  return {
    key: { ref: session.key.ref, instance: session.key.instance },
    title: candidateTitle(candidate),
    ...(item.label === undefined ? {} : { label: item.label }),
    ...(item.language === undefined ? {} : { language: item.language }),
    timeDependent: item.timeDependent,
    status: session.status,
    numAttempts: attemptsOf(session.variables),
    ...(left === undefined ? {} : { attemptsLeft: left }),
    body,
    stimuli,
    stylesheets: [...new Set(stylesheets)],
    catalogs,
    ...(item.companionMaterials === undefined ? {} : { companionMaterials: item.companionMaterials }),
    interactions,
    responses,
    modalFeedback,
    pci: pciViews(body, delivered),
    ...(delivered.variant === undefined ? {} : { variant: variantViewOf(delivered.variant, candidate.languages[0]) }),
    hazards: hazardExposure(candidate.hazards).map(({ hazard }) => ({
      hazard,
      avoided: state.needs.avoidedHazards.includes(hazard),
    })),
    ...(candidate.link === undefined ? {} : { lti: ltiViewOf(candidate.link) }),
  };
}
