# Portable custom interactions

A portable custom interaction (PCI) is code that an item brings with it: an AMD module that builds its own interface
([BPIG] §3.7.12). The code is the package author's, so it runs where it can do no harm. `mountPciFrame` puts each
interaction in a frame of its own, loads its modules with RequireJS, and passes what it does to the player as events.

```ts
import { EN_MESSAGES } from "@luthfanwakan/tempuh";
import { mountPciFrame } from "@luthfanwakan/tempuh/player";

const gate = "https://assets.example/g/dGFwLXRva2Vu.c2ln/";
const host = document.createElement("div");
document.body.append(host);

const frame = mountPciFrame(host, {
  staticUrl: "https://assets.example/static/",
  messages: EN_MESSAGES,
  prompt: "Tap each picture to reveal it.",
  language: "en",
  stylesheets: [`${gate}styles/item.css`],
  markup: `<qti-interaction-markup><img class="tap" src="${gate}ammonia.svg" alt="Ammonia"></qti-interaction-markup>`,
  modules: {
    baseUrl: `${gate}modules/`,
    paths: new Map([["tap", [`${gate}modules/tap`]]]),
    load: ["tap"],
  },
  typeIdentifier: "urn:fdc:hmhco.com:pci:tapToReveal",
  responseIdentifier: "RESPONSE",
  status: "interacting",
  boundTo: { base: { integer: 0 } },
  onEvent: (event) => console.log(event.type),
});

await frame.destroy();
```

## Serving the frame

The frame is three static files, which `pnpm build` writes to `dist/pci-frame/` and the package exports as
`@luthfanwakan/tempuh/pci-frame/*`:

| File         | Contents                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------- |
| `frame.html` | The document of the frame: it loads the two scripts below                                     |
| `require.js` | RequireJS 2.3.8 (MIT), unchanged                                                              |
| `bridge.js`  | The program of the frame: its policy, its document, the communication bridge and the messages |

The host serves them from the asset origin, outside the asset gate, next to `player.css`, under `staticUrl`: `frame.html`
at `<staticUrl>pci-frame/frame.html` and the stylesheet at `<staticUrl>player.css`. They hold no package data. The scripts
are classic scripts, so the files need no CORS headers, and the frame sets its own content security policy, so they need
no CSP header. A header can only restrict the frame further.

The page that mounts the player needs the origin of `staticUrl` in the `frame-src` of its content security policy. That
also keeps a module from navigating its own frame to another site.

## Options

`mountPciFrame(parent, options)` appends the `iframe` to `parent` and returns a `PciFrame`. It throws `DataError` when
`parent` is not an element or an option is not valid.

| Option               | Type                              | Meaning                                                                                                                                    |
| -------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `staticUrl`          | `string`                          | Base URL of the static files, ending in `/`                                                                                                |
| `origins`            | `string[]`                        | Origins besides the asset origin that scripts, styles, images, media and fonts may come from, such as `https://cdn.example`. Default: `[]` |
| `messages`           | `{ interactiveQuestion: string }` | The interface text; `Messages` fits                                                                                                        |
| `prompt`             | `string \| null`                  | The text of the interaction's prompt, which names the frame                                                                                |
| `language`           | `string`                          | The language of the item, a BCP 47 tag, for the document of the frame                                                                      |
| `className`          | `string`                          | The `class` of the interaction in the item, so that the item's stylesheets select its markup as they do there. Default: `""`               |
| `stylesheets`        | `string[]`                        | URLs of the item's stylesheets, loaded after `player.css`                                                                                  |
| `markup`             | `string`                          | The HTML of `qti-interaction-markup`, with the URLs in it resolved                                                                         |
| `modules`            | `PciModules`                      | The modules to load, below                                                                                                                 |
| `typeIdentifier`     | `string`                          | The `custom-interaction-type-identifier`                                                                                                   |
| `responseIdentifier` | `string`                          | The `response-identifier`                                                                                                                  |
| `status`             | `PciStatus`                       | `interacting`, `suspended`, `closed`, `solution` or `review`; the interaction is not to accept input in the last three                     |
| `properties`         | `Map<string, string>`             | The `data-*` attributes, named as `dataset` names them. Default: empty                                                                     |
| `templateVariables`  | `Map<string, unknown>`            | The template variables bound to the interaction, as JSON ([BPIG] App. C). Default: empty                                                   |
| `contextVariables`   | `Map<string, unknown>`            | The context variables bound to it, as JSON. Default: empty                                                                                 |
| `boundTo`            | `unknown`                         | The value of the response variable, as JSON                                                                                                |
| `state`              | `string \| null`                  | The state that `getState` gave before, to restore. Default: `null`                                                                         |
| `onEvent`            | `(event: PciEvent) => void`       | Receives what the interaction does                                                                                                         |

`PciModules`:

| Property      | Type                    | Meaning                                                                                                                        |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `baseUrl`     | `string`                | What RequireJS resolves names against, ending in `/`                                                                           |
| `paths`       | `Map<string, string[]>` | Each module name to absolute URLs without `.js`, tried in order: the primary location, then the fallback                       |
| `waitSeconds` | `number`                | Seconds that RequireJS waits for a script before it tries the next location; 0 waits for ever ([BPIG] §3.7.12.2). Default: `7` |
| `load`        | `string[]`              | The names of the modules to load, which register the interaction                                                               |

Maps keep names such as `__proto__` as data. Every URL is an absolute `http` or `https` URL, and every origin is only a
scheme, a host and a port.

## Loading

The frame gives RequireJS `baseUrl`, `paths` and `waitSeconds`, then requires the modules of `load`. A location that
answers with an error, or does not answer within `waitSeconds`, makes RequireJS try the next one of the module. A
dependency such as `define(["./renderer"], ...)` has the name `renderer` in the module's directory, which RequireJS
resolves against `baseUrl`. So when `baseUrl` is the directory of the primary module under the asset prefix of the
interaction, dependencies and the `url()` of stylesheets stay under that prefix.

The frame loads scripts from its own origin and from `origins` only. A location on another origin fails, and so does the
module that needs it, with the failure `modules`.

The communication bridge `qtiCustomInteractionContext` is the AMD module of that name and the property of `window`
([BPIG] §3.7.12.7). A module calls its `register`; once the modules have loaded and the stylesheets have loaded or
failed, the frame calls the registered factory with `getInstance(dom, configuration, state)`:

| Argument or property                                    | Value                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `dom`                                                   | A `qti-portable-custom-interaction` element with `className`, holding `markup` |
| `configuration.properties`                              | An object of `properties`                                                      |
| `configuration.templateVariables`, `contextVariables`   | Objects of the variables                                                       |
| `configuration.boundTo`, `responseIdentifier`, `status` | As in the options                                                              |
| `configuration.onready`, `ondone`                       | Callbacks that become the events `ready` and `done`                            |
| `state`                                                 | `state`, or `undefined`                                                        |

## Events

| `type`      | Fields                        | When                                                                                                                             |
| ----------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ready`     | `state`                       | The interaction called `onready`                                                                                                 |
| `changed`   | `response`, `state`, `valid`  | The interaction fired `qti-interaction-changed`; the frame reads `getResponse()` and `getState()` then                           |
| `done`      | `response`, `state`, `status` | The interaction called `ondone`; `status` is the one it asks for (`interacting` when it gives none), which the player may refuse |
| `completed` | `response`, `state`           | `destroy` collected the final response and state of an interaction that exists                                                   |
| `failed`    | `reason`                      | The interaction did not start                                                                                                    |

`response` is the JSON of [BPIG] App. C that the interaction gave, or `null` when `getResponse()` gave `undefined`. The
module checks that it is JSON, and nothing more: the caller decodes it against the declaration of the response variable.
`valid` is what the interaction says in the event, or `undefined`. A `failed` reason is one of:

| Reason     | Meaning                                                             |
| ---------- | ------------------------------------------------------------------- |
| `csp`      | The browser did not apply the frame's policy, so nothing was loaded |
| `modules`  | A module did not load from any of its locations in time             |
| `register` | The modules loaded, but none registered the `typeIdentifier`        |
| `instance` | The factory threw                                                   |

## The `PciFrame`

| Member                    | Meaning                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `element`                 | The `iframe`                                                                                |
| `checkValidity()`         | Resolves with the verdict of the interaction's `checkValidity`, or `undefined` for none     |
| `reportValidity()`        | The same with `reportValidity`                                                              |
| `setCustomValidity(text)` | Sets the custom validity message; `""` clears it                                            |
| `getCustomValidity()`     | Resolves with the message, or `undefined`                                                   |
| `destroy()`               | Sends the event `completed`, lets the interaction call `oncompleted`, and removes the frame |

A validity method resolves with `undefined` when the interaction is not running, lacks the method, throws, or does not
answer within two seconds. `destroy` waits at most two seconds for a frozen module and returns the same promise when
called again.

Before it removes the frame, `destroy` has the frame call `getResponse()` and `getState()`, send them, and then call
`oncompleted()` ([BPIG] §3.7.12.7.4), so a listener flushes the final response before the module cleans up. An interaction
that is to see new markup or a new status is mounted again with the saved state ([BPIG] §3.7.12).

## The frame and its limits

The `iframe` has `sandbox="allow-scripts"` and no `allow-same-origin`, so its origin is opaque. The module has no cookie,
`localStorage`, `sessionStorage` or IndexedDB, cannot read the player's document or location, cannot navigate the top
window, open a window or submit a form.

When the player starts it, the frame restricts itself with this policy, in a `meta` element, before it loads anything:

| Directive                                                            | Sources                                                               |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `default-src`, `connect-src`, `frame-src`, `form-action`, `base-uri` | `'none'`                                                              |
| `script-src`                                                         | the origin of the frame and `origins`; no inline script, no `eval`    |
| `style-src`                                                          | the same, and `'unsafe-inline'`, because most interactions set styles |
| `img-src`, `media-src`, `font-src`                                   | the same, and `data:`                                                 |

So a module reaches no network by `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, a worker, a
dynamic `import()`, an image, a script, a stylesheet or a frame. A module that builds code with `eval` or `new Function`,
as some template libraries do, fails. The frame then checks that the policy is in force with a script from a `data:` URL,
which the policy refuses. Where that script loads, the browser applies no policy: the frame reports `csp` and loads
nothing.

Everything a module sends is untrusted. The player reads a message only from the frame's window, only with the shape of
the table above, and with JSON for a response. It sets the height of the frame to the content height the frame
reports, between 48 and 4096 CSS pixels (`MIN_PCI_HEIGHT` and `MAX_PCI_HEIGHT`); taller content scrolls in the frame.

A module is code of the package and its source is visible to the candidate, so it must not hold an answer key.

## The name and the focus

The frame is named by `title`: the prompt of the interaction with its white space collapsed, or the message
`interactiveQuestion` when there is no prompt (WCAG 4.1.2). Tab moves the focus into the frame and out of it, forward and
back, as it does for any frame (WCAG 2.1.2); a module that traps the key traps the candidate, which the player cannot
prevent.

## Errors

`mountPciFrame` throws `DataError` for an option of the wrong type, a URL that is not absolute `http` or `https`, a base
URL that does not end in `/`, and an origin that is more than a scheme, a host and a port. A message from the frame that
fails its check is dropped, not thrown.
