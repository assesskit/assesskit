import type { TimerView } from "@assesskit/runtime/delivery/wire";
import type { Messages } from "../../messages/index.js";
import { clockText, html, replaceAll } from "../internal.js";
import type { Announcer } from "./announcer.js";
import { spokenText } from "./duration.js";

/**
 * The seconds before a limit at which the candidate is told how much time is left.
 *
 * @see {@link https://www.w3.org/TR/WCAG22/#timing-adjustable | WCAG 2.2, timing adjustable}
 */
const TIMER_WARNINGS: readonly number[] = [300, 60];

/** The timers of the view, with the means to hide them and to announce the warnings. */
export interface TimerBar {
  /** The region of the timers, hidden while the view has none. */
  readonly element: HTMLElement;
  /**
   * Shows the timers of a new view.
   *
   * @param timers - The timers of the view.
   * @param age - The age of the view in milliseconds.
   */
  update(timers: readonly TimerView[], age: number): void;
  /**
   * Counts the timers down to the age of the view, in milliseconds, and announces a warning or the end of a limit.
   *
   * @param age - The age of the view in milliseconds.
   */
  tick(age: number): void;
}

const LABELS: Readonly<Record<TimerView["scope"], keyof Messages>> = {
  test: "timerTest",
  part: "timerPart",
  section: "timerSection",
  item: "timerItem",
};

/** A timer on screen: its view and the elements that its time is written to. */
interface Row {
  readonly key: string;
  readonly timer: TimerView;
  readonly maximum?: HTMLElement;
  readonly minimum?: HTMLElement;
}

/**
 * Creates the timers.
 *
 * @remarks
 * Each shows the time left to its maximum, and the time before the candidate may leave when the scope has a minimum,
 * counted down from the moment the view was made. A limit that passed and still takes answers says so. The candidate can
 * hide the timers. The time left is not a live region: a screen reader would read it each second. Instead the status
 * region announces it 300 and 60 seconds before a limit, and says when the time is over. That region keeps the room of a
 * line from the first view that has a timer, so that a warning moves nothing; a test without timers has no such room.
 *
 * @param messages - The text of the interface.
 * @param language - The language of the interface, for the spoken time.
 * @param announcer - The region that announces the warnings.
 * @returns The timer bar.
 * @see {@link https://www.w3.org/TR/WCAG22/#timing-adjustable | WCAG 2.2, timing adjustable}
 * @see {@link https://www.w3.org/TR/WCAG22/#pause-stop-hide | WCAG 2.2, pause, stop, hide}
 */
export function createTimerBar(messages: Messages, language: string, announcer: Announcer): TimerBar {
  const list = html("ul", { class: "ak-timer-list" });
  const toggle = html("button", { type: "button", class: "ak-button", "data-focus-id": "timer-toggle" });
  const element = html("div", { class: "ak-timers", role: "group", "aria-label": messages.timersLabel }, list, toggle);
  element.hidden = true;
  announcer.element.hidden = true;
  let hidden = false;
  let rows: Row[] = [];
  const warned = new Set<string>();

  const showToggle = (): void => {
    toggle.textContent = hidden ? messages.timerShow : messages.timerHide;
    list.hidden = hidden;
  };
  toggle.addEventListener("click", () => {
    hidden = !hidden;
    showToggle();
  });
  showToggle();

  const warn = (row: Row, left: number): void => {
    const seconds = Math.ceil(left / 1000);
    const crossed = TIMER_WARNINGS.filter((limit) => seconds <= limit && !warned.has(`${row.key} ${limit}`));
    for (const limit of crossed) warned.add(`${row.key} ${limit}`);
    if (crossed.length > 0 && left > 0) {
      announcer.say(`${messages.timerWarning} ${spokenText(left, language)}`);
    }
  };

  /** Writes the time left to the maximum of a timer, or says that it passed and still takes answers. */
  const tickMaximum = (row: Row, maximum: HTMLElement, age: number): void => {
    if (row.timer.late) {
      maximum.textContent = messages.timerLate;
      return;
    }
    const left = Math.max(0, (row.timer.remaining ?? 0) - age);
    maximum.textContent = clockText(left);
    warn(row, left);
    if (left === 0 && !warned.has(`${row.key} over`)) {
      warned.add(`${row.key} over`);
      announcer.say(messages.timerExpired);
    }
  };

  const tick = (age: number): void => {
    for (const row of rows) {
      if (row.maximum !== undefined) tickMaximum(row, row.maximum, age);
      if (row.minimum !== undefined) {
        const left = Math.max(0, (row.timer.minimumRemaining ?? 0) - age);
        row.minimum.textContent = clockText(left);
        row.minimum.closest("li")?.toggleAttribute("hidden", left === 0);
      }
    }
  };

  /** Builds the entries of a timer: one for its maximum time and one for its minimum time, when it has them. */
  const rowOf = (timer: TimerView): { readonly row: Row; readonly entries: HTMLElement[] } => {
    const maximum = timer.remaining === undefined && !timer.late ? undefined : html("time", { class: "ak-time" });
    const minimum = timer.minimumRemaining === undefined ? undefined : html("time", { class: "ak-time" });
    const entry = (label: string, time: HTMLElement): HTMLElement =>
      html("li", {}, html("span", {}, `${label}: `), time);
    return {
      row: {
        key: `${timer.scope} ${timer.identifier}`,
        timer,
        ...(maximum === undefined ? {} : { maximum }),
        ...(minimum === undefined ? {} : { minimum }),
      },
      entries: [
        ...(maximum === undefined ? [] : [entry(messages[LABELS[timer.scope]], maximum)]),
        ...(minimum === undefined ? [] : [entry(messages.timerMinimum, minimum)]),
      ],
    };
  };

  return {
    element,
    tick,
    update: (timers, age) => {
      const built = timers.map(rowOf);
      rows = built.map(({ row }) => row);
      replaceAll(
        list,
        built.flatMap(({ entries }) => entries),
      );
      const known = new Set(rows.map(({ key }) => key));
      for (const key of [...warned]) if (!known.has(key.slice(0, key.lastIndexOf(" ")))) warned.delete(key);
      element.hidden = rows.length === 0;
      if (rows.length > 0) announcer.element.hidden = false;
      tick(age);
    },
  };
}
