"use strict";
// Registers two interactions, so that an identifier that matches neither cannot be taken for the only one.
define(["qtiCustomInteractionContext"], function (context) {
  ["urn:test:a", "urn:test:b"].forEach(function (typeIdentifier) {
    context.register({
      typeIdentifier: typeIdentifier,
      getInstance: function (dom, configuration) {
        parent.postMessage({ probe: "made", typeIdentifier: typeIdentifier }, "*");
        configuration.onready({}, "{}");
        return { typeIdentifier: typeIdentifier, getResponse: function () {}, getState: function () { return "{}"; } };
      },
    });
  });
});
