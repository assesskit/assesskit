import { type ModalFeedback, readAsi } from "@assesskit/runtime/asi";
import { afterEach, describe, expect, inject, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { EN_MESSAGES } from "../src/index.js";
import { type ContentRootOptions, createContentRoot } from "../src/player/index.js";
import { PLAYER_CSS, stylesheet } from "./css-fixture.js";
import { axeViolations, itemBody } from "./renderer-fixture.js";

const { asset } = inject("fixtures");

const TOKEN = crypto.randomUUID();
const ASSETS = `${asset}/content/${TOKEN}/`;

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

/** Reads the modal feedback of an item written as XML with the runtime. */
function feedbackOf(...entries: readonly string[]): readonly ModalFeedback[] {
  const document = readAsi(
    `<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="f" title="f" adaptive="false" time-dependent="false">
       <qti-item-body><p>Question.</p></qti-item-body>${entries.join("")}
     </qti-assessment-item>`,
  );
  if (document.kind !== "item") throw new Error("not an item");
  return document.item.modalFeedback;
}

const RIGHT = `<qti-modal-feedback outcome-identifier="FB" identifier="right" show-hide="show" title="Well done"><qti-content-body><p>You chose <em>well</em>. <a href="#x">See below</a>.</p></qti-content-body></qti-modal-feedback>`;
const NEXT = `<qti-modal-feedback outcome-identifier="FB" identifier="next" show-hide="show"><qti-content-body><p>Now the next question.</p><img src="images/dot.png" alt="A dot"/></qti-content-body></qti-modal-feedback>`;

/** Creates a content root that shows an item and has a button before it, which opens the feedback. */
async function open(hostStyle = "") {
  const opener = document.createElement("button");
  opener.textContent = "Submit";
  document.body.append(opener);
  hosts.push(opener);
  const host = document.createElement("div");
  if (hostStyle !== "") host.setAttribute("style", hostStyle);
  document.body.append(host);
  hosts.push(host);
  const options: ContentRootOptions = {
    messages: EN_MESSAGES,
    assets: (path) => `${ASSETS}${path}`,
    fetch: (url, request) => fetch(url, request),
    stylesheet: stylesheet(PLAYER_CSS),
  };
  const root = createContentRoot(host, options);
  await root.show({ body: { nodes: itemBody('<p>Question. <a href="#x">link</a></p>'), base: "items/q1/item.xml" } });
  return { host, root, opener };
}

const dialogOf = (root: ShadowRoot): HTMLDialogElement => {
  const dialog = root.querySelector("dialog");
  if (dialog === null) throw new Error("The root has no dialog.");
  return dialog;
};

describe("modal feedback", () => {
  it("opens as a modal dialog named Feedback, with the title and the content of each feedback", async () => {
    const { root } = await open();
    const closed = root.showFeedback(feedbackOf(RIGHT, NEXT));
    const dialog = dialogOf(root.root);
    expect(dialog.open).toBe(true);
    expect(dialog.matches(":modal")).toBe(true);
    const name = root.root.getElementById(dialog.getAttribute("aria-labelledby") ?? "");
    expect(name?.textContent).toBe("Feedback");
    expect(name?.localName).toBe("h2");
    const entries = [...dialog.querySelectorAll("qti-modal-feedback")];
    expect(entries.map((entry) => entry.querySelector("h3")?.textContent ?? null)).toEqual(["Well done", null]);
    expect(entries[0]?.querySelector("p")?.textContent).toBe("You chose well. See below.");
    expect(entries[1]?.querySelector("img")?.getAttribute("src")).toBe(`${ASSETS}items/q1/images/dot.png`);
    expect(getComputedStyle(entries[0] as Element).display).toBe("block");
    dialog.close();
    await closed;
  });

  it("starts at the heading, so that a screen reader reads the dialog from its name", async () => {
    const { root, opener } = await open();
    opener.focus();
    const closed = root.showFeedback(feedbackOf(RIGHT));
    const dialog = dialogOf(root.root);
    expect(root.root.activeElement).toBe(dialog.querySelector("h2"));
    dialog.close();
    await closed;
  });

  it("closes with the Close button from the keyboard", async () => {
    const { root, opener } = await open();
    opener.focus();
    const closed = root.showFeedback(feedbackOf(RIGHT));
    const close = dialogOf(root.root).querySelector("button");
    if (close === null) throw new Error("The dialog has a Close button.");
    await userEvent.type(close, "{Enter}");
    await closed;
    expect(root.root.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("closes with Escape and with the Close button, removes the dialog and gives the focus back to where it was", async () => {
    const { root, opener } = await open();
    opener.focus();
    let closed = root.showFeedback(feedbackOf(RIGHT));
    await userEvent.keyboard("{Escape}");
    await closed;
    expect(root.root.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);

    closed = root.showFeedback(feedbackOf(NEXT));
    const close = dialogOf(root.root).querySelector("button");
    expect(close?.textContent).toBe("Close");
    close?.click();
    await closed;
    expect(root.root.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("makes the item behind it inert while it is open", async () => {
    const { root, opener } = await open();
    const closed = root.showFeedback(feedbackOf(RIGHT));
    const behind = root.root.querySelector<HTMLElement>(".ak-content a");
    behind?.focus();
    opener.focus();
    expect(root.root.activeElement).not.toBe(behind);
    expect(document.activeElement).not.toBe(opener);
    dialogOf(root.root).close();
    await closed;
  });

  it("is not clipped by the containment of the content root: the dialog is in the top layer, over the whole viewport", async () => {
    const { host, root } = await open("width: 120px; height: 40px; overflow: hidden;");
    await page.viewport(900, 700);
    const closed = root.showFeedback(feedbackOf(RIGHT, NEXT));
    const dialog = dialogOf(root.root).getBoundingClientRect();
    const box = host.getBoundingClientRect();
    expect(dialog.width).toBeGreaterThan(box.width + 40);
    expect(dialog.height).toBeGreaterThan(box.height + 40);
    expect(dialog.left).toBeGreaterThanOrEqual(0);
    expect(dialog.right).toBeLessThanOrEqual(window.innerWidth);
    expect(Math.abs(dialog.left + dialog.width / 2 - window.innerWidth / 2)).toBeLessThan(2);
    expect(getComputedStyle(host).contain).toBe("layout paint");
    // What is drawn at the middle of the viewport is the dialog's content, not the clipped root.
    const hit = root.root.elementFromPoint(window.innerWidth / 2, dialog.top + 20);
    expect(hit === null || dialogOf(root.root).contains(hit)).toBe(true);
    dialogOf(root.root).close();
    await closed;
  });

  it("passes axe with the dialog open", async () => {
    const { host, root } = await open();
    const closed = root.showFeedback(feedbackOf(RIGHT, NEXT));
    expect(await axeViolations(host)).toEqual([]);
    dialogOf(root.root).close();
    await closed;
  });

  it("uses the language of the interface for its heading and its button", async () => {
    const { root } = await open();
    const closed = root.showFeedback([]);
    expect(dialogOf(root.root).querySelector("h2")?.textContent).toBe("Feedback");
    dialogOf(root.root).close();
    await closed;
  });
});
