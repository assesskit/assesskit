# Supported

What `@assesskit/player` draws and operates. A cell says Yes, Partly (the note says what is left out) or No (see Not
included).

```mermaid
flowchart LR
  subgraph host["The host: outside the player"]
    login["Login and authentication"]
    storage["Storage of sessions, files and results"]
    proctor["Proctoring, who gets which support"]
    tools["Dictionary, thesaurus and the other tools of the host"]
  end
  subgraph player["@assesskit/player"]
    browser["Browser: player, client"]
    server["Server: session host, asset gate, scoring, CAT"]
    shared["Shared: protocol, messages"]
  end
  runtime[("@assesskit/runtime: the engine and the QTI model")]
  host --> player
  browser <--> shared
  server <--> shared
  player --> runtime
```

| Part                                                                                              | Supported | Notes                                                                                         |
| ------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------- |
| Item and stimulus bodies, shared stimuli, HTML, MathML, SSML, stylesheets, shared CSS classes     | Yes       | Content is sanitized: no script, event handler, inline style or reference outside the package |
| Images, audio, video, text tracks, `object`, links                                                | Yes       | Package files only, or an origin that the host allows                                         |
| Feedback, template content, rubric blocks, catalogs and cards                                     | Yes       | As the view of the runtime resolves them                                                      |
| The 20 interactions of QTI 3.0 besides the two custom ones                                        | Yes       | Each with keyboard operation, and without a drag where the interaction takes a drag           |
| Portable custom interactions                                                                      | Yes       | In a sandboxed frame; modules load from the package                                           |
| Custom interaction (deprecated)                                                                   | Partly    | A hook of the host draws it; without the hook the player shows a notice                       |
| Navigation, submission, confirmations, timers, review, solution, comments, suspension             | Yes       | The controls come from the actions that the view lists and that the policy of the host allows |
| Exam mode: session host, asset gate, scheduler, stores, caller binding, proctor                   | Yes       | The answer keys stay on the server                                                            |
| Practice mode: the engine on the device                                                           | Yes       | The same client interface as exam mode                                                        |
| Personal needs and preferences: look, cards, captions, reading aloud, magnification, masks, tools | Yes       | See [Supports](supports.md) and [Tools](tools.md)                                             |
| Companion materials: rule, protractor, calculators, line reader, digital and physical materials   | Yes       |                                                                                               |
| Interface languages                                                                               | Yes       | English and Indonesian; the language of the profile chooses the catalog                       |
| Adaptive testing                                                                                  | Yes       | Through the runtime's `CatPort`: a client for the REST binding of CAT 1.0, or any engine      |
| LTI items: read, shown and scored; the launch goes through the port `LtiLogin`                    | Yes       | [LTI items](lti-items.md); the launch and the grade services are in interopkit                |
| Scoring: submissions for raters, supplying a score, provisional results                           | Yes       | [Scoring](scoring.md)                                                                         |

| Engine   | Oldest version | How it is tested                                                        |
| -------- | -------------- | ----------------------------------------------------------------------- |
| Chromium | 111            | The suites in the current engine, and a smoke test in the oldest one    |
| Firefox  | 115            | The same                                                                |
| Safari   | 16.4           | The suites in the current WebKit, and a smoke test in the oldest WebKit |

The server folders (`server`, `cat-rest`) run on Node.js 22 or later. [Baseline](baseline.md) lists
the features that the browser code does not use.

## WCAG 2.2, levels A and AA

| How the criteria are checked | Criteria                                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A test of their own          | 1.1.1, 1.2.1, 1.2.2, 1.2.3, 1.2.5, 1.3.1, 1.4.1, 1.4.2, 1.4.3, 1.4.4, 1.4.10, 1.4.11, 1.4.12, 1.4.13, 2.1.1, 2.1.2, 2.1.4, 2.2.1, 2.4.3, 2.4.7, 2.4.11, 2.5.1, 2.5.7, 2.5.8, 3.1.2, 3.2.4, 3.3.1, 3.3.2, 3.3.3, 3.3.4, 4.1.2, 4.1.3 |
| axe-core only                | 1.3.2, 1.3.4, 2.2.2, 2.3.1, 2.4.1, 2.4.4, 2.4.6, 2.5.2, 2.5.3, 3.1.1, 3.2.1, 3.2.2: axe-core runs with the rules of both levels on the rendered player and decides what it can                                                      |
| By a person                  | 1.3.3, 1.4.5, 3.2.3, 3.2.6: the message catalog, the chrome for images of text, the order of the chrome and the slot for help                                                                                                       |
| Not applicable               | 1.2.4, 1.3.5, 2.4.2, 2.4.5, 2.5.4, 3.3.7, 3.3.8                                                                                                                                                                                     |

| Criterion                       | Why it does not apply                                                       |
| ------------------------------- | --------------------------------------------------------------------------- |
| 1.2.4 Captions (Live)           | The player has no live media.                                               |
| 1.3.5 Identify Input Purpose    | The player collects no personal data; login is the host's.                  |
| 2.4.2 Page Titled               | The page is the host's. The view gives the titles of the test and the item. |
| 2.4.5 Multiple Ways             | A test is a process, which the criterion excepts.                           |
| 2.5.4 Motion Actuation          | No input comes from motion.                                                 |
| 3.3.7 Redundant Entry           | Nothing is entered twice.                                                   |
| 3.3.8 Accessible Authentication | Authentication is the host's. An LTI launch needs no cognitive test.        |

The suites cannot show that a whole product is accessible: the host's page, its login and its content are the host's.

## Not included

| What                                                                                                                               | Why                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LTI launches, the grade services, Caliper events and any other protocol of a learning platform                                     | [interopkit](https://github.com/interopkit/interopkit) implements them; the player has the ports they plug into.                                                                                           |
| Deciding who gets which support, encouragement and environment supports, proctoring                                                | The host decides and runs them. The player applies the profile it is given.                                                                                                                                |
| Authoring                                                                                                                          | The player shows content; it has no editor.                                                                                                                                                                |
| Storage of sessions, files and results                                                                                             | The host gives the player stores and a file store.                                                                                                                                                         |
| The dictionary, thesaurus, homophone checker, note taking, visual organizer, outliner, peer interaction and spell checker supports | The tools are the host's. The player has a slot for each.                                                                                                                                                  |
| A time extension for a candidate during a session                                                                                  | The runtime has no host action for it, and the player never decides a rule of QTI. A host that needs it adds the action to the runtime first.                                                              |
| A read of the status, the current item and the time left of a session for a proctor's dashboard                                    | `HostSession` is the host's side of the actions and of the pending work. A dashboard reads the stored session through the store it gave and the engine's `view`, and the player adds no second read of it. |
| Fetching from a network on its own                                                                                                 | The CAT adapter takes a `fetch` that the host passes; the player never fetches by itself.                                                                                                                  |
| Live captions and media that the content does not provide                                                                          | The player shows the media and tracks of the content.                                                                                                                                                      |
| Certification by 1EdTech                                                                                                           | Certification is for products, with member-only test sets.                                                                                                                                                 |

## The claim

| Part                     | Evidence                                                                                                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What the runtime decides | Items are differentially tested and test sessions are specification-tested: [the runtime's claim](../runtime/supported.md#the-claim) holds for the player, which draws and operates what the runtime describes.                         |
| What the player adds     | Tested in Chromium, Firefox and WebKit on the 1EdTech examples and on fixtures, with axe-core at WCAG 2.2 levels A and AA, with scripted keyboard use, and over HTTP for the exam server and the integrations: [Evidence](evidence.md). |
| Certification            | Not certified by 1EdTech.                                                                                                                                                                                                               |
