import {
  type AssessmentItem,
  type Gap,
  type HotText,
  type Interaction,
  listDescendantNodes,
  type ModelNode,
} from "../asi/index.js";
import { withDescendants } from "../asi/internal.js";
import { checkArray, checkRecord } from "../checks.js";
import type { BaseType, ValueDeclaration } from "../values/index.js";
import { anyBindings, bind, containerBindings, TEXT_BASE_TYPES } from "./bindings.js";
import type { ChoiceDescriptor, InteractionConstraints, InteractionDescriptor, InteractionKind } from "./descriptor.js";

/**
 * A maximum of 0 means no restriction.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const UNLIMITED = 0;

/**
 * The maximum of choices and associations when the attribute is absent.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const DEFAULT_MAXIMUM = 1;

/**
 * The number base of a text interaction when `base` is absent.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const DEFAULT_BASE = 10;

/**
 * The step of a slider bound to an integer when `step` is absent.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const INTEGER_STEP = 1;

/** The attributes of the elements that count as choices of an interaction, as the model has them. */
interface ChoiceElement {
  readonly identifier: string;
  readonly fixed?: boolean;
  readonly templateIdentifier?: string;
  readonly showHide?: "show" | "hide";
  readonly matchGroup?: readonly string[];
  readonly matchMax?: number;
  readonly matchMin?: number;
  readonly required?: boolean;
}

/** What each kind of interaction adds to the identity and the declaration that every descriptor has. */
type Parts = Pick<InteractionDescriptor, "bindings" | "choices" | "constraints" | "shuffle"> &
  Partial<Pick<InteractionDescriptor, "matchSets" | "stringIdentifier">>;

/** Returns `value` as a minimum, or `undefined` for 0, which demands nothing. */
function minimumOf(value: number | undefined): number | undefined {
  return value === undefined || value === 0 ? undefined : value;
}

/** Returns `value`, or the default when it is absent, as a maximum; `undefined` for 0, which is no restriction. */
function maximumOf(value: number | undefined, fallback: number): number | undefined {
  const maximum = value ?? fallback;
  return maximum === UNLIMITED ? undefined : maximum;
}

function choiceLimits(
  min: number | undefined,
  max: number | undefined,
  fallback: number,
): Pick<InteractionConstraints, "maxChoices" | "minChoices"> {
  const lower = minimumOf(min);
  const upper = maximumOf(max, fallback);
  return {
    ...(lower === undefined ? {} : { minChoices: lower }),
    ...(upper === undefined ? {} : { maxChoices: upper }),
  };
}

function associationLimits(
  min: number | undefined,
  max: number | undefined,
  fallback: number,
): Pick<InteractionConstraints, "maxAssociations" | "minAssociations"> {
  const lower = minimumOf(min);
  const upper = maximumOf(max, fallback);
  return {
    ...(lower === undefined ? {} : { minAssociations: lower }),
    ...(upper === undefined ? {} : { maxAssociations: upper }),
  };
}

/**
 * Returns the limits of an order interaction: without `min-choices` every choice must be ordered and `max-choices` is
 * ignored; with it the candidate orders between `min-choices` and `max-choices` of the choices.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function orderLimits(
  min: number | undefined,
  max: number | undefined,
): Pick<InteractionConstraints, "maxChoices" | "minChoices"> {
  if (min === undefined) return {};
  const upper = maximumOf(max, UNLIMITED);
  return { minChoices: min, ...(upper === undefined ? {} : { maxChoices: upper }) };
}

/** Returns the descriptor of a choice, a gap, a hotspot or a hot text. */
function choiceOf(element: ChoiceElement): ChoiceDescriptor {
  const {
    identifier,
    fixed = false,
    templateIdentifier,
    showHide = "show",
    matchGroup = [],
    required = false,
  } = element;
  const matchMax = maximumOf(element.matchMax, UNLIMITED);
  const matchMin = minimumOf(element.matchMin);
  return {
    identifier,
    fixed,
    ...(templateIdentifier === undefined ? {} : { templateIdentifier }),
    showHide,
    ...(matchMax === undefined ? {} : { matchMax }),
    ...(matchMin === undefined ? {} : { matchMin }),
    ...(matchGroup.length === 0 ? {} : { matchGroup }),
    ...(required ? { required } : {}),
  };
}

type InteractionOf<TKind extends InteractionKind> = Extract<Interaction, { kind: TKind }>;

/** Returns the parts of an interaction whose response is a selection of identifiers or points. */
function selectionParts(
  baseType: BaseType,
  maxChoices: number | undefined,
  fallback: number,
  min: number | undefined,
  choices: readonly ChoiceDescriptor[],
  shuffle: boolean | undefined,
): Parts {
  return {
    bindings: containerBindings(baseType, (maxChoices ?? fallback) === 1),
    choices,
    constraints: choiceLimits(min, maxChoices, fallback),
    shuffle: shuffle ?? false,
  };
}

/**
 * Returns the parts of an interaction whose response is a set of pairs. `fallback` is the maximum of associations when
 * the attribute is absent.
 */
function pairParts(
  baseType: BaseType,
  mayBeSingle: boolean,
  interaction: {
    readonly minAssociations?: number;
    readonly maxAssociations?: number;
    readonly shuffle?: boolean;
  },
  sets: readonly (readonly ChoiceDescriptor[])[],
  fallback = DEFAULT_MAXIMUM,
): Parts {
  return {
    bindings: containerBindings(baseType, mayBeSingle && (interaction.maxAssociations ?? DEFAULT_MAXIMUM) === 1),
    choices: sets.flat(),
    ...(baseType === "directedPair" ? { matchSets: sets } : {}),
    constraints: associationLimits(interaction.minAssociations, interaction.maxAssociations, fallback),
    shuffle: interaction.shuffle ?? false,
  };
}

function orderParts(
  interaction: InteractionOf<"graphic-order-interaction" | "order-interaction">,
  choices: readonly ChoiceDescriptor[],
): Parts {
  return {
    bindings: [bind("ordered", "identifier")],
    choices,
    constraints: orderLimits(interaction.minChoices, interaction.maxChoices),
    shuffle: interaction.kind === "order-interaction" ? (interaction.shuffle ?? false) : false,
  };
}

function textParts(interaction: InteractionOf<"extended-text-interaction" | "text-entry-interaction">): Parts {
  const extended = interaction.kind === "extended-text-interaction";
  // `max-strings` is required when the interaction is bound to a container.
  const containers = extended && interaction.maxStrings !== undefined;
  const minStrings = extended ? minimumOf(interaction.minStrings) : undefined;
  const maxStrings = extended ? maximumOf(interaction.maxStrings, UNLIMITED) : undefined;
  return {
    bindings: [
      bind("single", ...TEXT_BASE_TYPES),
      ...(containers ? [bind("multiple", ...TEXT_BASE_TYPES), bind("ordered", ...TEXT_BASE_TYPES)] : []),
      bind("record"),
    ],
    choices: [],
    constraints: {
      base: interaction.base ?? DEFAULT_BASE,
      ...(interaction.patternMask === undefined ? {} : { patternMask: interaction.patternMask }),
      ...(minStrings === undefined ? {} : { minStrings }),
      ...(maxStrings === undefined ? {} : { maxStrings }),
    },
    shuffle: false,
    ...(interaction.stringIdentifier === undefined ? {} : { stringIdentifier: interaction.stringIdentifier }),
  };
}

/**
 * Returns the parts of a slider: its bounds and step, read against the declared base type.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function sliderParts(
  interaction: InteractionOf<"slider-interaction">,
  declaration: ValueDeclaration | undefined,
): Parts {
  const integer = declaration?.baseType === "integer";
  const step = interaction.step ?? (integer ? INTEGER_STEP : undefined);
  return {
    bindings: [bind("single", "float", "integer")],
    choices: [],
    constraints: {
      lowerBound: integer ? Math.floor(interaction.lowerBound) : interaction.lowerBound,
      upperBound: integer ? Math.ceil(interaction.upperBound) : interaction.upperBound,
      ...(step === undefined ? {} : { step }),
    },
    shuffle: false,
  };
}

function mediaParts(interaction: InteractionOf<"media-interaction">): Parts {
  const minPlays = minimumOf(interaction.minPlays);
  const maxPlays = maximumOf(interaction.maxPlays, UNLIMITED);
  return {
    bindings: [bind("single", "integer")],
    choices: [],
    constraints: {
      ...(minPlays === undefined ? {} : { minPlays }),
      ...(maxPlays === undefined ? {} : { maxPlays }),
    },
    shuffle: false,
  };
}

function fileParts(mimeTypes: readonly string[]): Parts {
  return {
    bindings: [bind("single", "file")],
    choices: [],
    constraints: mimeTypes.length === 0 ? {} : { mimeTypes },
    shuffle: false,
  };
}

function inlineChoiceParts(interaction: InteractionOf<"inline-choice-interaction">): Parts {
  return {
    bindings: [bind("single", "identifier")],
    choices: interaction.inlineChoices.map(choiceOf),
    constraints: {
      ...choiceLimits(interaction.minChoices, undefined, UNLIMITED),
      ...(interaction.required === true ? { required: true } : {}),
    },
    shuffle: interaction.shuffle ?? false,
  };
}

/**
 * Returns what an interaction of the item adds to the descriptor.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function partsOf(interaction: Interaction, declaration: ValueDeclaration | undefined): Parts {
  switch (interaction.kind) {
    case "associate-interaction":
      return pairParts("pair", true, interaction, [interaction.simpleAssociableChoices.map(choiceOf)]);
    case "choice-interaction":
      return selectionParts(
        "identifier",
        interaction.maxChoices,
        DEFAULT_MAXIMUM,
        interaction.minChoices,
        interaction.simpleChoices.map(choiceOf),
        interaction.shuffle,
      );
    case "custom-interaction":
    case "portable-custom-interaction":
      return { bindings: anyBindings(), choices: [], constraints: {}, shuffle: false };
    case "drawing-interaction":
      return fileParts([]);
    case "end-attempt-interaction":
      return { bindings: [bind("single", "boolean")], choices: [], constraints: {}, shuffle: false };
    case "extended-text-interaction":
    case "text-entry-interaction":
      return textParts(interaction);
    case "gap-match-interaction": {
      const gaps = listDescendantNodes(interaction).flatMap((node) => (isGap(node) ? [choiceOf(node)] : []));
      // The schema defaults max-associations to 1, but a text with several gaps takes several associations, and the examples of 1EdTech leave the attribute out: an absent attribute is no limit, since each gap
      // takes one choice.
      return pairParts(
        "directedPair",
        gaps.length <= 1,
        interaction,
        [interaction.choices.map(choiceOf), gaps],
        UNLIMITED,
      );
    }
    case "graphic-associate-interaction":
      return pairParts("pair", true, interaction, [interaction.associableHotspots.map(choiceOf)]);
    case "graphic-gap-match-interaction":
      // As for the gap match interaction: an absent max-associations is no limit, and match-max limits each hotspot.
      return pairParts(
        "directedPair",
        false,
        interaction,
        [interaction.choices.map(choiceOf), interaction.associableHotspots.map(choiceOf)],
        UNLIMITED,
      );
    case "graphic-order-interaction":
      return orderParts(interaction, interaction.hotspotChoices.map(choiceOf));
    case "hotspot-interaction":
      return selectionParts(
        "identifier",
        interaction.maxChoices,
        DEFAULT_MAXIMUM,
        interaction.minChoices,
        interaction.hotspotChoices.map(choiceOf),
        undefined,
      );
    case "hottext-interaction":
      return selectionParts(
        "identifier",
        interaction.maxChoices,
        DEFAULT_MAXIMUM,
        interaction.minChoices,
        listDescendantNodes(interaction).flatMap((node) => (isHotText(node) ? [choiceOf(node)] : [])),
        undefined,
      );
    case "inline-choice-interaction":
      return inlineChoiceParts(interaction);
    case "match-interaction":
      return pairParts(
        "directedPair",
        true,
        interaction,
        interaction.simpleMatchSets.map((set) => set.simpleAssociableChoices.map(choiceOf)),
      );
    case "media-interaction":
      return mediaParts(interaction);
    case "order-interaction":
      return orderParts(interaction, interaction.simpleChoices.map(choiceOf));
    case "position-object-interaction":
      return selectionParts("point", interaction.maxChoices, DEFAULT_MAXIMUM, interaction.minChoices, [], undefined);
    case "select-point-interaction":
      return selectionParts("point", interaction.maxChoices, UNLIMITED, interaction.minChoices, [], undefined);
    case "slider-interaction":
      return sliderParts(interaction, declaration);
    case "upload-interaction":
      return fileParts(interaction.type ?? []);
  }
}

/**
 * Returns whether a node is an interaction: the elements named `qti-…-interaction` are the 22 interactions.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function isInteraction(node: ModelNode): node is Interaction {
  return node.kind.endsWith("-interaction");
}

const isGap = (node: ModelNode): node is Gap => node.kind === "gap";

const isHotText = (node: ModelNode): node is HotText => node.kind === "hottext";

/** The descriptors of the items described so far, so that a session reads an item's body once. */
const DESCRIPTORS = new WeakMap<AssessmentItem, readonly InteractionDescriptor[]>();

/**
 * Describes the interactions of an item in document order: the response variable each binds, the bindings it accepts,
 * its choices, what a valid response needs and whether the choices shuffle.
 *
 * @remarks
 * The descriptors hold the item as authored, with every choice, hidden or not, so that shuffling can draw over all of
 * them; the delivery engine drops the hidden ones before it presents the choices.
 *
 * Attributes that a document omits have the defaults of the schema, and a maximum of 0, which means no restriction, is
 * left out of the constraints.
 *
 * The descriptors of an item are built on the first call and shared by the later ones, which an item that is not changed
 * after it is read allows; the result is read-only.
 *
 * @param item - The item, as `readAsi` reads it.
 * @returns One descriptor for each interaction in the body of the item, including those inside feedback and template
 * content and the position object interactions of a stage; none for an item without a body.
 * @throws `DataError` when `item` is not an object of the model of `qti-assessment-item`.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 * @example
 * ```ts
 * import { readAsi } from "@assesskit/runtime/asi";
 * import { describeInteractions } from "@assesskit/runtime/interactions";
 *
 * const { item } = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
 *     identifier="capital" title="Capital" time-dependent="false">
 *   <qti-response-declaration identifier="RESPONSE" cardinality="multiple" base-type="identifier"/>
 *   <qti-item-body>
 *     <qti-choice-interaction response-identifier="RESPONSE" min-choices="1" max-choices="2">
 *       <qti-simple-choice identifier="Paris">Paris</qti-simple-choice>
 *       <qti-simple-choice identifier="Lyon" fixed="true">Lyon</qti-simple-choice>
 *     </qti-choice-interaction>
 *   </qti-item-body>
 * </qti-assessment-item>`);
 * const [descriptor] = describeInteractions(item);
 * descriptor.constraints; // => { minChoices: 1, maxChoices: 2 }
 * descriptor.bindings; // => [{ cardinality: "multiple", baseTypes: ["identifier"] }]
 * descriptor.choices.map(({ identifier, fixed }) => [identifier, fixed]); // => [["Paris", false], ["Lyon", true]]
 * ```
 */
export function describeInteractions(item: AssessmentItem): readonly InteractionDescriptor[] {
  const input: unknown = item;
  checkRecord(input, "The item must be an object of the model of qti-assessment-item");
  checkArray(input.responseDeclarations, "The response declarations of the item must be an array");
  if (item.body === undefined) return [];
  checkArray(item.body.children, "The children of the item body must be an array");
  const known = DESCRIPTORS.get(item);
  if (known !== undefined) return known;
  const declarations = new Map(item.responseDeclarations.map((declaration) => [declaration.identifier, declaration]));
  const described = withDescendants(item.body.children)
    .filter(isInteraction)
    .map((interaction): InteractionDescriptor => {
      const declared = declarations.get(interaction.responseIdentifier);
      const declaration: ValueDeclaration | undefined =
        declared === undefined
          ? undefined
          : {
              cardinality: declared.cardinality,
              ...(declared.baseType === undefined ? {} : { baseType: declared.baseType }),
            };
      return {
        kind: interaction.kind,
        responseIdentifier: interaction.responseIdentifier,
        ...(declaration === undefined ? {} : { declaration }),
        ...partsOf(interaction, declaration),
      };
    });
  DESCRIPTORS.set(item, described);
  return described;
}
