import type { AngleUnit, LengthUnit, ProtractorSpec, RuleSpec } from "./model.js";

/**
 * CSS pixels in a millimeter: a CSS inch is 96 pixels and an inch is 25.4 millimeters.
 *
 * @see {@link https://www.w3.org/TR/css-values-4/#absolute-lengths | CSS Values and Units 4, absolute lengths}
 */
export const CSS_PX_PER_MM = 96 / 25.4;

/** The least distance between two ticks in CSS pixels; ticks closer than this are left out, so that a scale stays readable. */
export const MIN_TICK_PX = 3;

/** The least distance between two numbers on a scale in CSS pixels, enough for four digits. */
export const MIN_LABEL_PX = 32;

/** The least relative distance of a position from a major tick for it to be a tick of its own, which absorbs the error of floating point. */
const COINCIDENCE = 1e-9;

/**
 * Returns the millimeters in a unit of length.
 *
 * @param unit - The unit.
 * @returns The millimeters.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, units of length}
 */
export function millimeters(unit: LengthUnit): number {
  switch (unit) {
    case "Millimeter":
      return 1;
    case "Centimeter":
      return 10;
    case "Meter":
      return 1000;
    case "Kilometer":
      return 1_000_000;
    case "Inch":
      return 25.4;
    case "Foot":
      return 304.8;
    case "Yard":
      return 914.4;
    case "Mile":
      return 1_609_344;
  }
}

/**
 * Returns the degrees in a unit of angle: a minute is a sixtieth of a degree and a second a sixtieth of a minute.
 *
 * @param unit - The unit.
 * @returns The degrees.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, units of angle}
 */
export function degrees(unit: AngleUnit): number {
  switch (unit) {
    case "Radian":
      return 180 / Math.PI;
    case "Degree":
      return 1;
    case "Minute":
      return 1 / 60;
    case "Second":
      return 1 / 3600;
  }
}

/**
 * Returns the symbol that names a unit on a scale.
 *
 * @param unit - The unit.
 * @returns The symbol.
 */
export function unitSymbol(unit: LengthUnit | AngleUnit): string {
  switch (unit) {
    case "Millimeter":
      return "mm";
    case "Centimeter":
      return "cm";
    case "Meter":
      return "m";
    case "Kilometer":
      return "km";
    case "Inch":
      return "in";
    case "Foot":
      return "ft";
    case "Yard":
      return "yd";
    case "Mile":
      return "mi";
    case "Radian":
      return "rad";
    case "Degree":
      return "\u00b0";
    case "Minute":
      return "\u2032";
    case "Second":
      return "\u2033";
  }
}

/** A tick of a scale. */
interface Tick {
  /** The distance from the origin of the scale, in millimeters or degrees. */
  readonly at: number;
  /** Whether the tick is a major one, drawn longer. */
  readonly major: boolean;
  /** Whether the tick carries its number. */
  readonly labelled: boolean;
}

/** What decides the ticks of a scale; lengths are in millimeters or degrees. */
interface ScaleLayout {
  /** The length of the scale. */
  readonly extent: number;
  /** Pixels in a unit of the scale. */
  readonly pxPerUnit: number;
  /** The distance between major ticks. */
  readonly majorStep: number;
  /** The distance between minor ticks, or `null` for none. */
  readonly minorStep: number | null;
}

/**
 * Lays out the ticks of a scale.
 *
 * @remarks
 * Ticks closer than {@link MIN_TICK_PX} are left out and so are numbers closer than {@link MIN_LABEL_PX}, which bounds the
 * work by the length of the scale in pixels whatever the increments are: an item can ask for a step of a millionth of the
 * length.
 */
function scaleTicks({ extent, pxPerUnit, majorStep, minorStep }: ScaleLayout): readonly Tick[] {
  const majorPx = majorStep * pxPerUnit;
  // At most one tick, at the origin, when the step is longer than the scale.
  const stride = Math.min(Math.max(1, Math.ceil(MIN_TICK_PX / majorPx)), Math.max(1, Math.ceil(extent / majorStep)));
  const strideStep = stride * majorStep;
  const labelEvery = Math.max(1, Math.ceil(MIN_LABEL_PX / (stride * majorPx)));
  const ticks: Tick[] = [];
  for (let index = 0; index * strideStep <= extent * (1 + COINCIDENCE); index++) {
    ticks.push({ at: Math.min(extent, index * strideStep), major: true, labelled: index % labelEvery === 0 });
  }
  if (minorStep !== null && minorStep * pxPerUnit >= MIN_TICK_PX) {
    for (let index = 0; index * minorStep <= extent * (1 + COINCIDENCE); index++) {
      const onMajor = (index * minorStep) / strideStep;
      if (Math.abs(onMajor - Math.round(onMajor)) > COINCIDENCE) {
        ticks.push({ at: Math.min(extent, index * minorStep), major: false, labelled: false });
      }
    }
  }
  return ticks;
}

/** A rule laid out for a width. */
export interface RuleScale {
  /** The length of the rule in CSS pixels. */
  readonly lengthPx: number;
  /** Pixels in a millimeter: {@link CSS_PX_PER_MM}, or less when the rule would not fit. */
  readonly pxPerMm: number;
  /** Millimeters in the unit of the major increment, which the numbers on the rule are in. */
  readonly unitMm: number;
  /** The unit of the numbers on the rule. */
  readonly unit: LengthUnit;
  /** The ticks, with `at` in millimeters. */
  readonly ticks: readonly Tick[];
}

/**
 * Lays out a rule: it is as long as `minimumLength` in the unit of the major increment, at the size of a CSS millimeter,
 * or smaller, with the same proportions, when it would not fit in the available width.
 *
 * @param rule - What the item asks for.
 * @param availablePx - The width that is available, in CSS pixels.
 * @returns The layout.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, rule}
 */
export function ruleScale({ minimumLength, minorIncrement, majorIncrement }: RuleSpec, availablePx: number): RuleScale {
  const unitMm = millimeters(majorIncrement.unit);
  const extent = minimumLength * unitMm;
  const pxPerMm = Math.min(CSS_PX_PER_MM, availablePx / extent);
  return {
    lengthPx: extent * pxPerMm,
    pxPerMm,
    unitMm,
    unit: majorIncrement.unit,
    ticks: scaleTicks({
      extent,
      pxPerUnit: pxPerMm,
      majorStep: majorIncrement.value * unitMm,
      minorStep: minorIncrement === undefined ? null : minorIncrement.value * millimeters(minorIncrement.unit),
    }),
  };
}

/**
 * The angle a protractor measures, in degrees.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, protractor}
 */
export const PROTRACTOR_EXTENT = 180;

/** A protractor laid out for a radius. */
export interface ProtractorScale {
  /** Degrees in the unit of the major increment, which the numbers on the protractor are in. */
  readonly unitDegrees: number;
  /** The unit of the numbers on the protractor. */
  readonly unit: AngleUnit;
  /** The ticks, with `at` in degrees from the right end of the base line. */
  readonly ticks: readonly Tick[];
}

/**
 * Lays out a protractor: a half circle with ticks along its arc.
 *
 * @param protractor - What the item asks for.
 * @param radiusPx - The radius, in CSS pixels.
 * @returns The layout.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, protractor}
 */
export function protractorScale({ minorIncrement, majorIncrement }: ProtractorSpec, radiusPx: number): ProtractorScale {
  const unitDegrees = degrees(majorIncrement.unit);
  return {
    unitDegrees,
    unit: majorIncrement.unit,
    ticks: scaleTicks({
      extent: PROTRACTOR_EXTENT,
      pxPerUnit: (radiusPx * Math.PI) / PROTRACTOR_EXTENT,
      majorStep: majorIncrement.value * unitDegrees,
      minorStep: minorIncrement === undefined ? null : minorIncrement.value * degrees(minorIncrement.unit),
    }),
  };
}
