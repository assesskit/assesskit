import type { DrawingInteraction } from "@assesskit/runtime/asi";
import type { InteractionDescriptor } from "@assesskit/runtime/interactions";
import type { Point } from "@assesskit/runtime/values";
import { single } from "@assesskit/runtime/values";
import { EN_MESSAGES, type Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../internal.js";
import { createInteraction, InteractionElement } from "./element.js";
import {
  FREEHAND_TOOLS,
  fillRuns,
  type Operation,
  paint,
  type Shape,
  type Stroke,
  type Tool,
} from "./graphic/operations.js";
import { enablePicker } from "./graphic/picker.js";
import { createStage, stageOf } from "./graphic/stage.js";
import { Notes } from "./notes.js";
import type { InteractionFiles } from "./options.js";
import { nameByPrompt, renderPrompt } from "./parts.js";
import { fileOf } from "./values.js";

/** The tools in the order of the toolbar, with the message that names each. */
const TOOLS: readonly { readonly tool: Tool; readonly name: keyof Messages }[] = [
  { tool: "pen", name: "drawToolPen" },
  { tool: "eraser", name: "drawToolEraser" },
  { tool: "line", name: "drawToolLine" },
  { tool: "rectangle", name: "drawToolRectangle" },
  { tool: "ellipse", name: "drawToolEllipse" },
  { tool: "fill", name: "drawToolFill" },
];

/** The colors of the pen, the shapes and the fill, with the message that names each. */
const COLORS: readonly { readonly color: string; readonly name: keyof Messages }[] = [
  { color: "#000000", name: "drawColorBlack" },
  { color: "#c62828", name: "drawColorRed" },
  { color: "#2e7d32", name: "drawColorGreen" },
  { color: "#1565c0", name: "drawColorBlue" },
  { color: "#f9a825", name: "drawColorYellow" },
];

/** The width of a line is this fraction of the smaller side of the image, and at least two units of the image. */
const LINE_DIVISOR = 60;
const LINE_MINIMUM = 2;

/** The media type that a file gets when the author names none and the path of the image has no known extension. */
const DEFAULT_TYPE = "image/png";

/** The media types of the image file extensions that a canvas can name. */
const EXTENSION_TYPES: ReadonlyMap<string, string> = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["bmp", "image/bmp"],
]);

/** The state of the picture at one point of the drawing: the picture that lies under the strokes, and the strokes. */
interface Snapshot {
  readonly base: string;
  readonly operations: readonly Operation[];
}

/** Returns whether a name is the key of a message of the interface. */
const isMessage = (name: string | undefined): name is keyof Messages =>
  name !== undefined && Object.hasOwn(EN_MESSAGES, name);

/** Returns whether a tool is one that takes two points. */
const isShape = (tool: Tool): tool is Shape["tool"] => tool === "line" || tool === "rectangle" || tool === "ellipse";

/**
 * The element of `qti-drawing-interaction`: the candidate draws on an image, and the response is a file with the picture
 * and the drawing in the media type of the image.
 *
 * @remarks
 * The host stores the file (`InteractionFiles.upload`); the response refers to it, and `settled` resolves once the latest
 * drawing is stored.
 *
 * - **Pointer:** the pen and the eraser follow the pointer, a path that only a pointer can give. The line, the rectangle
 *   and the ellipse are placed by two clicks, and the fill by one, which is the single-pointer way to draw.
 * - **Keyboard:** with one of those tools the image takes the focus, a crosshair moves with the arrow keys, and Enter or
 *   Space picks the point.
 *
 * Undo goes back one drawing action, and Clear back to the image the question gave. A response that the player gives is
 * shown as the picture to draw on.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, drawing interaction}
 * @see {@link https://www.w3.org/TR/WCAG22/#pointer-gestures | WCAG 2.2, pointer gestures}
 * @see {@link https://www.w3.org/TR/WCAG22/#keyboard | WCAG 2.2, keyboard}
 */
export class DrawingInteractionElement extends InteractionElement {
  /** The kind of interaction that the element is for. */
  override readonly kind = "drawing-interaction";
  /** The host's storage of drawings. */
  #files: InteractionFiles | undefined;
  /** The media type of the image, in which the picture is stored. */
  #type = DEFAULT_TYPE;

  #tool: Tool = "pen";
  #color = "#000000";
  #start: Point | undefined;
  #stroke: Stroke | undefined;
  #history: Snapshot[] = [];
  #original: string | undefined;
  #known: string | undefined;
  #pending: Promise<void> = Promise.resolve();
  #queued = 0;
  /** Whether the picture on show could not be decoded, so that there is nothing to draw on. */
  #failed = false;
  readonly #usage = html("p", { class: "ak-usage" });
  #loaded: { readonly url: string; readonly image: HTMLImageElement } | undefined;

  constructor() {
    super();
    enablePicker(this, {
      active: () => this.#answerable() && !FREEHAND_TOOLS.has(this.#tool),
      pick: (point) => this.#pick(point),
    });
    this.addEventListener("click", (event) => {
      const button =
        event.target instanceof Element
          ? event.target.closest("button[data-tool], button[data-color], button[data-action]")
          : null;
      if (!(button instanceof HTMLButtonElement)) return;
      const { tool, color, action } = button.dataset;
      if (tool !== undefined) this.#select(tool);
      else if (color !== undefined) this.#color = color;
      else if (action === "undo") this.#undo();
      else if (action === "clear") this.#clear();
      this.refresh();
    });
    this.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      this.#start = undefined;
      this.#showStart();
    });
    this.addEventListener("pointerdown", (event) => this.#press(event));
    this.addEventListener("pointermove", (event) => this.#move(event));
    this.addEventListener("pointerup", (event) => this.#release(event));
    this.addEventListener("pointercancel", () => this.#abort());
    // A touch that moves scrolls the page and the browser cancels the pointer, unless the move is cancelled.
    this.addEventListener(
      "touchmove",
      (event) => {
        if (this.#stroke !== undefined) event.preventDefault();
      },
      { passive: false },
    );
    // The picture has its size once it has loaded, and the canvas has the pixels of the picture.
    this.addEventListener(
      "load",
      (event) => {
        if (event.target === this.#image()) this.#setFailed(false);
        void this.#fit();
      },
      true,
    );
    // Some engines decode the picture that was there before when the source has just changed, so that they say only by
    // this event that the new one cannot be drawn on.
    this.addEventListener(
      "error",
      (event) => {
        if (event.target === this.#image()) this.#setFailed(true);
      },
      true,
    );
  }

  /**
   * Resolves when the drawing has been stored, which the response waits for.
   *
   * @returns A promise that resolves when nothing is being stored.
   */
  override settled(): Promise<void> {
    return this.#pending;
  }

  #answerable(): boolean {
    return this.descriptor !== undefined && !this.disabled && this.#files !== undefined;
  }

  #image(): HTMLImageElement | null {
    return this.querySelector(".ak-stage img");
  }

  #canvas(): HTMLCanvasElement | null {
    return this.querySelector("canvas.ak-canvas");
  }

  #current(): Snapshot | undefined {
    return this.#history.at(-1);
  }

  /** Returns the width of lines and the pixels of the canvas for one unit of the image, or `undefined` until the image has a size. */
  #metrics(): { readonly width: number; readonly scale: number } | undefined {
    const canvas = this.#canvas();
    const size = stageOf(this.querySelector(".ak-layer"))?.size;
    if (canvas === null || size === undefined || canvas.width === 0) return undefined;
    return {
      width: Math.max(LINE_MINIMUM, Math.round(Math.min(size.width, size.height) / LINE_DIVISOR)),
      scale: canvas.width / size.width,
    };
  }

  #select(tool: string): void {
    const chosen = TOOLS.find((entry) => entry.tool === tool);
    if (chosen === undefined) return;
    this.#tool = chosen.tool;
    this.#start = undefined;
    this.#showStart();
  }

  #showStart(): void {
    const marker = this.querySelector<HTMLElement>(".ak-start");
    if (marker === null) return;
    marker.hidden = this.#start === undefined;
    if (this.#start !== undefined) {
      marker.style.setProperty("--ak-x", String(this.#start[0]));
      marker.style.setProperty("--ak-y", String(this.#start[1]));
    }
  }

  /** Takes the point that the candidate picked for a shape or a fill. */
  #pick(point: Point): void {
    const [tool, color, start] = [this.#tool, this.#color, this.#start];
    if (tool === "fill") this.#commit({ tool, color, at: point });
    else if (!isShape(tool)) return;
    else if (start === undefined) {
      this.#start = point;
      this.#say("drawStartSet");
      this.#showStart();
    } else {
      this.#start = undefined;
      this.#showStart();
      this.#commit({ tool, color, from: start, to: point });
    }
  }

  #press(event: PointerEvent): void {
    const surface = this.querySelector<HTMLElement>(".ak-surface");
    if (event.target !== surface || surface === null || !event.isPrimary || event.button !== 0) return;
    const point = stageOf(this.querySelector(".ak-layer"))?.pointAt(event.clientX, event.clientY);
    if ((this.#tool !== "pen" && this.#tool !== "eraser") || !this.#answerable() || point === undefined) return;
    surface.setPointerCapture(event.pointerId);
    this.#stroke = { tool: this.#tool, color: this.#color, points: [point] };
    this.#paintStroke(this.#stroke);
  }

  #move(event: PointerEvent): void {
    const point = stageOf(this.querySelector(".ak-layer"))?.pointAt(event.clientX, event.clientY);
    const stroke = this.#stroke;
    const last = stroke?.points.at(-1);
    if (stroke === undefined || last === undefined || point === undefined) return;
    this.#stroke = { ...stroke, points: [...stroke.points, point] };
    this.#paintStroke({ ...stroke, points: [last, point] });
  }

  #release(event: PointerEvent): void {
    const point = stageOf(this.querySelector(".ak-layer"))?.pointAt(event.clientX, event.clientY);
    const stroke = this.#stroke;
    if (stroke === undefined) return;
    this.#stroke = undefined;
    this.#commit(point === undefined ? stroke : { ...stroke, points: [...stroke.points, point] }, true);
  }

  #abort(): void {
    if (this.#stroke === undefined) return;
    this.#stroke = undefined;
    void this.#replay();
  }

  #paintStroke(stroke: Stroke): void {
    const context = this.#canvas()?.getContext("2d");
    const metrics = this.#metrics();
    if (context !== null && context !== undefined && metrics !== undefined)
      paint(context, stroke, metrics.scale, metrics.width);
  }

  /**
   * Runs a change of the drawing after the ones before it, and stores the drawing after the last of a run of changes, so
   * that a quick series of actions makes one file and `settled` waits for all of it.
   */
  #enqueue(change: () => Promise<void>): void {
    this.#queued += 1;
    this.#pending = this.#pending
      .then(async () => {
        this.#queued -= 1;
        await change();
        if (this.#queued === 0) await this.#save();
      })
      .catch(() => this.#say("drawSaveFailed"));
  }

  /** Adds an action to the drawing; the pen has painted its stroke already. */
  #commit(operation: Operation, painted = false): void {
    this.#enqueue(async () => {
      const current = this.#current();
      if (current === undefined) return;
      this.#history.push({ base: current.base, operations: [...current.operations, operation] });
      if (!painted) await this.#paint(operation);
    });
  }

  #undo(): void {
    this.#start = undefined;
    this.#showStart();
    this.#enqueue(async () => {
      if (this.#history.length < 2) return;
      this.#history.pop();
      await this.#show();
    });
  }

  #clear(): void {
    this.#enqueue(async () => {
      const base = this.#original;
      if (base === undefined) return;
      this.#history.push({ base, operations: [] });
      await this.#show();
    });
  }

  /** Shows the current snapshot: its picture, and its strokes on it. */
  async #show(): Promise<void> {
    const image = this.#image();
    const base = this.#current()?.base;
    if (image === null || base === undefined) return;
    if (image.getAttribute("src") !== base) {
      image.setAttribute("src", base);
      try {
        await image.decode();
      } catch {
        // A picture that replaced this one while it was decoding fails this decode too, and that is no failure of its own.
        if (image.getAttribute("src") === base) this.#setFailed(true);
        return;
      }
      this.#setFailed(image.complete && image.naturalWidth === 0);
    }
    await this.#fit();
  }

  /** Records whether the picture can be drawn on, and shows the hint of the element when that changes. */
  #setFailed(failed: boolean): void {
    if (this.#failed === failed) return;
    this.#failed = failed;
    this.refresh();
  }

  /** Gives the canvas the pixels of the picture, and the strokes of the current snapshot back. */
  async #fit(): Promise<void> {
    const image = this.#image();
    const canvas = this.#canvas();
    if (image === null || canvas === null || image.naturalWidth === 0) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    await this.#replay();
  }

  async #replay(): Promise<void> {
    const canvas = this.#canvas();
    const snapshot = this.#current();
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    for (const operation of snapshot?.operations ?? []) {
      if (this.#current() !== snapshot) return;
      await this.#paint(operation);
    }
  }

  async #paint(operation: Operation): Promise<void> {
    const canvas = this.#canvas();
    const context = canvas?.getContext("2d");
    const metrics = this.#metrics();
    if (canvas === null || context === null || context === undefined || metrics === undefined) return;
    if (operation.tool !== "fill") {
      paint(context, operation, metrics.scale, metrics.width);
      return;
    }
    try {
      const composite = await this.#composite(canvas);
      const pixels = composite.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height);
      if (pixels === undefined) return;
      context.fillStyle = operation.color;
      const at: Point = [Math.round(operation.at[0] * metrics.scale), Math.round(operation.at[1] * metrics.scale)];
      for (const { x0, x1, y } of fillRuns(pixels, at)) context.fillRect(x0, y, x1 - x0 + 1, 1);
    } catch {
      this.#say("drawSaveFailed");
    }
  }

  /** Loads the picture under the strokes so that a canvas can read it, which the host's origin must allow (CORS). */
  async #loadBase(url: string): Promise<HTMLImageElement> {
    if (this.#loaded?.url === url) return this.#loaded.image;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = url;
    await image.decode();
    this.#loaded = { url, image };
    return image;
  }

  /** Returns a canvas with the picture and the strokes on it, as they stand. */
  async #composite(strokes: HTMLCanvasElement): Promise<HTMLCanvasElement> {
    const base = this.#current()?.base;
    const composite = document.createElement("canvas");
    composite.width = strokes.width;
    composite.height = strokes.height;
    const context = composite.getContext("2d");
    if (base === undefined || context === null) return composite;
    context.drawImage(await this.#loadBase(base), 0, 0, composite.width, composite.height);
    context.drawImage(strokes, 0, 0);
    return composite;
  }

  async #save(): Promise<void> {
    const files = this.#files;
    const canvas = this.#canvas();
    const snapshot = this.#current();
    if (files === undefined || canvas === null || snapshot === undefined) return;
    if (snapshot.operations.length === 0 && snapshot.base === this.#original) {
      this.#known = undefined;
      this.respond(null);
      return;
    }
    const composite = await this.#composite(canvas);
    const blob = await new Promise<Blob | null>((resolve) => composite.toBlob(resolve, this.#type));
    if (blob === null) throw new Error("The canvas gave no picture.");
    const file = await files.upload(blob, blob.type, `drawing.${blob.type.split("/")[1] ?? "png"}`);
    this.#known = file.reference;
    this.respond(single("file", file));
  }

  /**
   * Starts the drawing on the image of the question, or on a response that this element did not give: a drawing the player
   * shows is the picture to draw on, and the drawing starts again on it.
   */
  #restore(image: HTMLImageElement): void {
    this.#original ??= image.getAttribute("src") ?? undefined;
    const file = fileOf(this.value);
    const first = this.#history.length === 0;
    if (this.#original === undefined || (!first && file?.reference === this.#known)) return;
    this.#known = file?.reference;
    const base = file === undefined || this.#files === undefined ? this.#original : this.#files.url(file);
    this.#history = [{ base, operations: [] }];
    void this.#show();
  }

  /** Says something to the candidate who cannot see the change, in the words of the interface. */
  #say(key: "drawStartSet" | "drawSaveFailed"): void {
    const messages = this.messages;
    if (messages !== undefined) this.notes?.announce(messages[key]);
  }

  /** Names the parts of the toolbar and gives the instructions. */
  protected override configure(_descriptor: InteractionDescriptor, messages: Messages): void {
    for (const element of this.querySelectorAll<HTMLElement>("[data-name]")) {
      const text = isMessage(element.dataset.name) ? messages[element.dataset.name] : "";
      // A swatch has no text of its own: the name of its color is its label.
      if (element instanceof HTMLButtonElement && element.dataset.color === undefined) element.textContent = text;
      else element.setAttribute("aria-label", text);
    }
    this.querySelector(".ak-surface")?.setAttribute("aria-label", messages.graphicPicker);
    this.#usage.textContent = messages.drawHint;
  }

  /** Shows which tool and color are chosen, and what the candidate can do. */
  protected override sync(): void {
    const image = this.#image();
    if (image === null) return;
    this.#restore(image);
    const answerable = this.#answerable();
    for (const button of this.querySelectorAll<HTMLButtonElement>(
      "button[data-tool], button[data-color], button[data-action]",
    )) {
      const { tool, color, action } = button.dataset;
      button.disabled = !answerable || (action === "undo" && this.#history.length < 2);
      if (action === undefined) {
        button.setAttribute("aria-pressed", String(tool === undefined ? color === this.#color : tool === this.#tool));
      }
    }
    const surface = this.querySelector<HTMLElement>(".ak-surface");
    if (surface !== null) surface.tabIndex = answerable && !FREEHAND_TOOLS.has(this.#tool) ? 0 : -1;
  }

  protected override extraHints(messages: Messages): readonly string[] {
    return this.#failed ? [messages.drawLoadFailed] : [];
  }

  protected override controls(): readonly Element[] {
    const surface = this.querySelector(".ak-surface");
    return surface === null ? [] : [surface];
  }

  /**
   * Fills the element with the prompt, the toolbar, the image with the canvas that lies over it, the instructions and
   * the notes.
   *
   * @remarks
   * The picture is stored through `files`, in the media type of the image.
   *
   * @param node - The interaction.
   * @param renderer - The renderer of content.
   * @param files - Where the picture is stored.
   */
  build(node: DrawingInteraction, renderer: BodyRenderer, files: InteractionFiles): void {
    this.#files = files;
    this.#type = typeOf(node.image);
    const prompt = renderPrompt(node.prompt, renderer);
    const { element: stageElement, stage } = createStage(node.image, renderer);
    stage.layer.append(
      html("canvas", { class: "ak-canvas", width: "0", height: "0", "aria-hidden": "true" }),
      html("div", { class: "ak-start", hidden: "", "aria-hidden": "true" }),
      html("div", { class: "ak-surface", role: "application" }),
      html("div", { class: "ak-crosshair", hidden: "", "aria-hidden": "true" }),
    );
    const tools = html(
      "div",
      { class: "ak-tools", role: "group", "data-name": "drawTools" },
      ...TOOLS.map(({ tool, name }) => control(name, { "data-tool": tool, "aria-pressed": "false" })),
    );
    const colors = html(
      "div",
      { class: "ak-colors", role: "group", "data-name": "drawColors" },
      ...COLORS.map(({ color, name }) => {
        const swatch = control(name, { "data-color": color, "aria-pressed": "false" });
        swatch.style.setProperty("--ak-swatch", color);
        return swatch;
      }),
    );
    const actions = html(
      "div",
      { class: "ak-actions" },
      control("drawUndo", { "data-action": "undo" }),
      control("drawClear", { "data-action": "clear" }),
    );
    this.notes = new Notes();
    this.replaceChildren(
      ...(prompt === undefined ? [] : [prompt.element]),
      html("div", { class: "ak-toolbar" }, tools, colors, actions),
      stageElement,
      this.#usage,
      this.notes.element,
    );
    this.setAttribute("role", "group");
    nameByPrompt(this, prompt);
  }
}

/** Returns the media type of the file of the image, which the drawing keeps: the `type` of an `object`, else the one the extension of the path names. */
function typeOf(image: DrawingInteraction["image"]): string {
  if (image.kind === "object") return image.type;
  const { src } = image.kind === "picture" ? image.img : image;
  return EXTENSION_TYPES.get(src.split(/[?#]/u)[0]?.split(".").pop()?.toLowerCase() ?? "") ?? DEFAULT_TYPE;
}

/** Builds a button of the toolbar; `configure` gives it its text. */
function control(name: keyof Messages, data: Readonly<Record<string, string>>): HTMLButtonElement {
  return html("button", { type: "button", "data-name": name, ...data });
}

/**
 * Renders a `qti-drawing-interaction`.
 *
 * @param node - The interaction.
 * @param renderer - The renderer of content.
 * @param messages - The interface messages.
 * @param files - Where the picture is stored.
 * @returns The element.
 */
export function renderDrawing(
  node: DrawingInteraction,
  renderer: BodyRenderer,
  messages: Messages,
  files: InteractionFiles,
): Element {
  const element = createInteraction(DrawingInteractionElement, "qti-drawing-interaction", node, renderer, messages);
  element.build(node, renderer, files);
  return element;
}
