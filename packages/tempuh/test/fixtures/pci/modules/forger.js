"use strict";
// Posts messages that the player must drop or bound, after the frame's own layout has settled.
define(["qtiCustomInteractionContext"], function (context) {
  context.register({
    typeIdentifier: "urn:test:forger",
    getInstance: function (dom, configuration) {
      configuration.onready({}, "{}");
      setTimeout(function () {
        parent.postMessage({ type: "changed", response: { base: { integer: 1 } }, state: 5 }, "*");
        parent.postMessage({ type: "done", response: null, state: "{}", status: "suspended" }, "*");
        parent.postMessage({ type: "failed", reason: "everything" }, "*");
        parent.postMessage({ type: "height", height: -5 }, "*");
        parent.postMessage({ type: "height", height: 1.5 }, "*");
        parent.postMessage("done", "*");
        parent.postMessage(null, "*");
        parent.postMessage({ type: "height", height: 1000000 }, "*");
      }, 500);
      return { typeIdentifier: "urn:test:forger", getResponse: function () {}, getState: function () { return "{}"; } };
    },
  });
});
