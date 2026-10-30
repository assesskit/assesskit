"use strict";
// Depends on "cdn", which a test maps to a module on another origin.
define(["qtiCustomInteractionContext", "cdn"], function (context, cdn) {
  context.register({
    typeIdentifier: "urn:test:external",
    getInstance: function (dom, configuration) {
      parent.postMessage({ probe: "external", cdn: cdn.value }, "*");
      configuration.onready({}, "{}");
      return { typeIdentifier: "urn:test:external", getResponse: function () {}, getState: function () { return "{}"; } };
    },
  });
});
