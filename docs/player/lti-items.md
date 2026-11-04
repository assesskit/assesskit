# LTI items

A QTI package can hold an item that is a link to a tool: a resource of the type `imsbasiclti_xmlv1p3` with a
`cartridge_basiclti_link` document. The runtime reads and validates the link and models the item with two outcomes, `SCORE` and
`MAXSCORE`, that the tool scores. The player shows the tool in a frame. Everything between the player and the tool, the
launch, the grade services and the analytics events, belongs to the host and to the library it chooses. The player has four
ports for it and imports no library of another family.

```mermaid
flowchart LR
  subgraph assesskit["assesskit"]
    runtime["@assesskit/runtime<br/>readLtiLink, resolveLaunchUrl,<br/>the item with SCORE and MAXSCORE"]
    subgraph player["@assesskit/player"]
      frame["player: the frames of the tool<br/>LtiLogin"]
      srv["server: the session host<br/>forward.log, createToolScoreIntake"]
      scoring["scoring: buildSessionScore"]
    end
  end
  host["Your host, or the example<br/>examples/player/lms-integration"]
  kit["interopkit<br/>LTI platform and tool roles, Caliper"]
  tool["The tool"]
  lms["A learning platform<br/>gradebook, analytics store"]
  frame -->|ltiLogin| host
  host --> kit
  kit <-->|launch, scores| tool
  host -->|ToolScore| srv
  srv -->|each step| host
  host -->|results, pending| scoring
  kit -->|score, events| lms
  runtime --> frame
```

## Quick start

The first thing a host does when the player calls `ltiLogin`: read the link of the item and take the URL that launches the tool.

```ts
import { readLtiLink, resolveLaunchUrl } from "@assesskit/runtime/package";

const link = readLtiLink(`<cartridge_basiclti_link xmlns="http://www.imsglobal.org/xsd/imslticc_v1p0"
    xmlns:blti="http://www.imsglobal.org/xsd/imsbasiclti_v1p0">
  <blti:title>Chemistry lab</blti:title>
  <blti:launch_url>http://tool.example/launch</blti:launch_url>
  <blti:secure_launch_url>https://tool.example/launch</blti:secure_launch_url>
</cartridge_basiclti_link>`);
link.title; // => "Chemistry lab"
resolveLaunchUrl(link); // => "https://tool.example/launch"
```

| Port                                      | Direction                                             | Where                                                                      |
| ----------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| `LtiLogin`, `LtiFrame`                    | The player asks the host to start the tool of an item | `hooks.ltiLogin` of `mountDelivery` ([delivery](delivery.md#lti-items))    |
| `createToolScoreIntake`, `ToolScoreStore` | The score of the tool comes in as `supply-scores`     | `@assesskit/player/server` ([server](server.md#the-scores-of-tool-items))  |
| `forward.log`, `StepSink`                 | The session host gives each saved step to the host    | `@assesskit/player/server` ([server](server.md#forwarding-the-steps))      |
| `buildSessionScore`                       | The host reads the score of a session as plain data   | `@assesskit/player/scoring` ([scoring](scoring.md#the-score-of-a-session)) |

## The wiring

```mermaid
sequenceDiagram
  participant P as Player page
  participant H as Host route
  participant K as Library of the platform role
  participant G as Gradebook of the host
  participant T as Tool
  participant S as Session host
  participant J as Host job
  P->>H: ltiLogin(item, { signal })
  H->>H: read the link, resolveLaunchUrl(link)
  H->>K: prepareToolFrame(MessageInput), check with SessionHost.check
  K-->>H: the frame
  H-->>P: LtiFrame
  P->>T: frames open, login, launch
  T->>K: a score for the line item
  K->>G: keepScore(caller, session, line item, score)
  G->>S: intake.onScore(session, item, ToolScore)
  S-->>G: supply-scores applied
  S->>H: forward.log(step)
  H->>J: append to the outbox
  J->>S: results(), pending()
  J->>K: buildSessionScore, then the grade of the session
```

| Step | The host does                                                                                                                                                                                                                                                                                                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Answers `ltiLogin`: it reads the `LtiLink` of the item, takes the launch URL with `resolveLaunchUrl` of the runtime, describes the launch as a message in which the session is the context and the item instance is the resource link, and has its LTI library build the `LtiFrame`; the library calls the host's `check` first, which binds the message to the candidate with `SessionHost.check`. |
| 2    | Takes the score of the tool: the gradebook behind the grade services checks that the line item is a link of the tool and that the session is the user's, and gives each score to `intake.onScore` as a `ToolScore`; the host's log calls `intake.settle`, so that a score that came early is supplied when the item's session is over.                                                              |
| 3    | Publishes the outcome: the log only appends each step to an outbox, and a job outside any step reads `results()` and `pending()`, calls `buildSessionScore`, and sends the grade and the analytics events with its libraries.                                                                                                                                                                       |

The log never touches the network, so an outage of the platform never delays a candidate and never reads as a CAT failure.
Each grade of a line item needs a later time than the one before, even after a timeout whose outcome is not known; the example
records the time before it sends.

A host with a proctoring tool maps the actions of its Assessment Control Service to `SessionHost.proctor` (`pause`, `resume`
and `terminate` become `suspend`, `resume` and `end-test`), and starts the session when the tool sends the candidate back, after
the message is verified against the browser's user.

## The example

[`examples/player/lms-integration`](https://github.com/assesskit/assesskit/tree/main/examples/player/lms-integration) wires all three steps with
[interopkit](https://github.com/interopkit/interopkit), the family that implements LTI and Caliper: the platform role for the
launch, a `GradebookStore` over the score intake for the tool's score, the tool role's `publishScore` for the grade, an
`AssessmentControl` over `SessionHost.proctor` for a proctoring tool, and Caliper for the events. It holds the outbox, the three
jobs and the table that maps a delivery event to a Caliper event, and its test runs the whole exchange in Node. A host copies it
or writes its own against the ports; neither family imports the other.

## Errors

| Situation                                                                                                                               | Result                                                                                             | What to do                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| There is no `ltiLogin`, the hook fails, its answer is not a frame, or a URL of the frame is on the origin of the page or of `staticUrl` | The alert "The tool for this question could not be started."; a failure also goes to `reportError` | Pass `hooks.ltiLogin` that answers an `LtiFrame` from the host's authenticated route ([delivery](delivery.md#lti-items)) |
| The link cannot be read, or names only a vendor                                                                                         | `ReadError` of `readLtiLink`, or `DataError` of `resolveLaunchUrl`                                 | Fix the link ([package](../runtime/package.md#lti-links))                                                                |
| A score of the tool that is not final                                                                                                   | It is kept and not supplied                                                                        | Wait for the final score of the tool ([server](server.md#the-scores-of-tool-items))                                      |
| A score that is earlier than the one kept                                                                                               | It is ignored                                                                                      | Send the scores with the time at which the tool gave them                                                                |

## Not included

| Not included                                        | Why                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| The launch, the grade services, the roster, Caliper | They are protocols between learning platforms: interopkit implements them                |
| A `forward.scores` or an event sink in `forward`    | The host's `log` and a job do both; a field can be added later without breaking a host   |
| A launch of an item with no `ltiLogin`              | The player shows "The tool for this question could not be started." and the test goes on |
## Differences from the references

None for the player: the specifications leave the launch to the host. One question is open, which QTI outcomes an LTI item has: `SCORE` and `MAXSCORE`, both scored by the tool, and the host supplies them from the score that the tool gave ([G42](../runtime/spec-gaps.md)).
