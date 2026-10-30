# Delivery

`mountDelivery` of `@luthfanwakan/tempuh/player` shows a candidate session: the content of the engine's view and the chrome
around it. It follows a session client ([client](client.md)) and never knows whether the engine runs on a server or on the
device. It decides nothing of QTI: it sends the actions that the view lists and shows what the engine answers.

```ts
import { createRemoteSession } from "@luthfanwakan/tempuh/client";
import { mountDelivery } from "@luthfanwakan/tempuh/player";
import css from "@luthfanwakan/tempuh/player.css?inline"; // any bundler that imports a file as text

const stylesheet = new CSSStyleSheet();
stylesheet.replaceSync(css);

const initial = await (await fetch("/exam/view", { method: "POST" })).json(); // a ViewEnvelope from SessionHost.view
const client = createRemoteSession(async (envelope) => {
  const response = await fetch("/exam/handle", { method: "POST", body: JSON.stringify(envelope) });
  if (!response.ok) throw new Error(`The host answered ${response.status}.`);
  return response.json();
}, initial);

const mounted = mountDelivery(document.querySelector("#player") as HTMLElement, {
  client,
  files: {
    upload: async (bytes, mimeType) => (await fetch("/exam/upload", { method: "POST", body: bytes })).json(),
    read: async (file) => new Uint8Array(await (await fetch(`/exam/files/${file.reference}`)).arrayBuffer()),
    url: (file) => `/exam/files/${file.reference}`,
  },
  staticUrl: "https://assets.example/static/",
  stylesheet,
  fetch: (url, init) => fetch(url, init),
  language: "id",
});
```

## Options

| Option       | Type                                | Meaning                                                                                                                                                                                                                                                                    |
| ------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client`     | `SessionClient`                     | The session the player shows, sends its actions to, and resolves package paths through.                                                                                                                                                                                    |
| `files`      | `MountFiles`                        | The host's storage of files: `upload`, `read` and `url`. A file value is a reference to it everywhere (olah D7).                                                                                                                                                           |
| `staticUrl`  | `string`                            | The base URL of tempuh's static files, ending in `/`: `pci-frame/frame.html` and `player.css` are under it.                                                                                                                                                                |
| `stylesheet` | `CSSStyleSheet`                     | The stylesheet of the content, built from `player.css` ([styling](styling.md)).                                                                                                                                                                                            |
| `fetch`      | `StylesheetFetch`                   | Loads item stylesheets and the module resolution files of portable custom interactions from the gate. `fetch` of the page fits.                                                                                                                                            |
| `language`   | `string`                            | The language of the interface, a BCP 47 tag, which chooses the catalog of [messages](messages.md). Default: `"en"`.                                                                                                                                                        |
| `messages`   | `Record<string, Partial<Messages>>` | Messages that replace the shipped ones, by language tag. Default: none.                                                                                                                                                                                                    |
| `origins`    | `readonly string[]`                 | The origins besides the package's that content and portable custom interactions may load from. Default: none.                                                                                                                                                              |
| `mathjax`    | `string`                            | The URL of MathJax 4's `mml-chtml` component ([math](math.md)). Default: none, so that the browser renders MathML.                                                                                                                                                         |
| `chrome`     | `boolean`                           | Whether the player draws the navigation, timers, actions, attempts, comment box and panel of supports. A host that draws its own sets `false`. Default: `true`.                                                                                                            |
| `hooks`      | `object`                            | The hooks of the host: `customInteraction` mounts `qti-custom-interaction`, `record` says whether an upload of audio offers a recording (Default: `true`), and `voice` reads aloud (Default: the voice of the browser, `webSpeech()`, [speech](speech.md)). Default: none. |

`mountDelivery(host, options)` throws `DataError` when `host` is not an element that can have a shadow root and has none, or an
option is not of its type. It attaches an open shadow root to `host` and draws in it, so the page's styles do not reach the
chrome. The chrome uses the system colors and `rem` sizes, so it follows the color scheme, forced colors and the text size.
A host element mounts once: after `destroy`, mount into a new element.

It returns a `Mounted`:

| Member         | Meaning                                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `update(view)` | Shows a view in place of the one before. The player follows the client by itself, so a host calls it only to feed its own view.                                                                |
| `settled()`    | Resolves when the interactions of the item shown have handed over what the candidate gave. A host with `chrome: false` waits for it before it sends an action that submits or leaves the item. |
| `destroy()`    | Takes the content, the timers and the listeners away. The session client stays open: it belongs to the host.                                                                                   |

## What the player draws

| Part                  | Behavior                                                                                                                                                                                                                                                                                     | Row |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| Heading               | The title of the item, or of the test where no item is shown. It takes the focus when the item changes (WCAG 2.4.3).                                                                                                                                                                         | T54 |
| Navigation map        | A landmark of the visible sections and the item instances of the test part, from the engine's map, with each item's state in words. The current item has `aria-current`. An item that is not reachable cannot be chosen; a linear part lists the items presented so far and has no way back. | T54 |
| Actions               | One button for each type of action that `view.actions` lists and that a button can send. Nothing is offered that the engine, or the session host's client-action policy, left out: an exam has no pause button.                                                                              | T55 |
| Confirmations         | A modal dialog before `end-part`, `end-test` and a `submit` in a linear part (WCAG 3.3.4). The focus starts on the answer that goes back. Ending a part or the test says how many questions have an attempt open, and that a simultaneous part submits all its answers together.             | T56 |
| Timers                | The time left to each maximum time and the time before the candidate may leave, counted down from the moment the view was made. A limit that passed and still takes answers says so. The candidate can hide the timers (WCAG 2.2.2).                                                         | T57 |
| Timer warnings        | A status message 300 and 60 seconds before a limit, with the time left in words of the interface's language, and one when the time is over (WCAG 2.2.1). A page that loads inside the last minutes announces the time left.                                                                  | T57 |
| Review and solution   | Buttons to review a closed item and to show its solution, when the item allows them. The state of the item shows in the map.                                                                                                                                                                 | T58 |
| Comment box           | A labelled field and a button where the item allows a comment. A new comment replaces the one before.                                                                                                                                                                                        | T59 |
| Time-dependent notice | A note on an item whose task depends on time (BPIG §4.3).                                                                                                                                                                                                                                    | T60 |
| Suspension            | A note that the test is paused, and no action but the one the view lists. In an exam only the proctor suspends and resumes ([server](server.md#the-proctor)).                                                                                                                                | T61 |
| Attempts              | The attempts used and, for an item with a limit, the attempts left.                                                                                                                                                                                                                          | T62 |
| Rubric                | The candidate rubric of the test, its part and its sections, in the content of every item (INFO §2.10).                                                                                                                                                                                      | T64 |
| Supports              | The panel of the supports that are options, and what the supports that are on change: the look, the cards, the reading aloud and the notice of the variant ([supports](supports.md#in-the-player)).                                                                                          | T75 |

The map is hidden where the test part has fewer than two items. The tools, the line reader and the like belong to
[tools](tools.md) and are not drawn here.

## Refusals and status messages

The engine refuses a well-formed action that the rules do not allow, and leaves the state unchanged (olah E4). The player
says why, in the language of the interface, in a polite live region with `role="status"` that never takes the focus
(WCAG 4.1.3). The catalog has a message for each `RefusalCode`, and a test fails when olah adds a code that has none.

| Case                                             | Message (English)                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| The engine refused the action                    | The message of the code, such as "The time for this question is over." |
| The answers were saved (after a `set-responses`) | Answers saved.                                                         |
| A comment was saved                              | Comment saved.                                                         |
| The host could not be reached or could not save  | Your answers could not be sent. They will be sent again.               |
| The host rejected the action (`DataError`, 403)  | The test could not accept this action.                                 |

## Focus

| When                                                    | Where the focus goes                                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| The player starts                                       | Nowhere: it takes nothing from the page.                                                        |
| The item changes, or the test is suspended or ends      | The heading.                                                                                    |
| A new view arrives while a control of the chrome has it | The same control; the heading if the control is gone, such as the Submit button after a submit. |
| A confirmation opens                                    | "No, go back". Escape goes back, and the focus returns to the control that asked.               |

## The content

The content of a view goes to a content root ([content](content.md)): the rubric, the stimuli, the item and the test
feedback, with the documents they come from so that relative references resolve (`ViewEnvelope.documents`). The player draws it
again only when it differs from what is shown: a new item, another state of the item, or answers to review. A new view that
only carries the answers the candidate just gave leaves the interactions as they are, so the caret and the focus stay.
Modal feedback opens in a dialog once for each attempt.

Each interaction is an element of [interactions](interactions.md). The player gives it the descriptor of olah, whether the
candidate can respond (only while the item is interacting), and the response; it hears `tempuh-response` and sends
`set-responses`, and hears `tempuh-end-attempt` and sends `end-attempt`. It sets the response on an element when the content is
drawn and when the item is not interacting, as in review and in the solution, where the response is the engine's. While the
candidate interacts the element holds the response, so a view that answers an earlier request never takes back what was typed
since.

A request that submits or leaves the item (`submit`, `skip`, `next-attempt`, `end-attempt`, `end-part`, `end-test` and every
`move`) waits first for `settled()` of each interaction element, after the candidate has confirmed it. An interaction that
stores its response in the background, such as a drawing whose picture is being uploaded, hands it over by then, and the
`set-responses` that carries it goes before the request. Without this the request would reach the engine first, and the
drawing would be missing from what is submitted or lost with the item.

Each portable custom interaction runs in its frame ([PCI](pci.md)). The player loads its module resolution files from the
gate, mounts the frame with the response, the state `getState` gave before, the template and context values and the status
of the item, and stores each response it gives with its state in `set-responses`, so that the interaction restores on any
device. A `done` event is a response; the candidate decides when to submit.

## Interfaces

```ts
interface MountFiles {
  upload(bytes: Blob, mimeType: string, fileName?: string): Promise<FileValue>;
  read(file: FileValue): Promise<Uint8Array>;
  url(file: FileValue): string;
}
```

`url` is synchronous. In an exam the URL comes from the host's server (`AssetGate.signFile`), whose tokens last five
minutes ([asset gate](asset-gate.md#files-of-the-candidate)), so a host that needs one for playback asks for it before it
shows the file.
