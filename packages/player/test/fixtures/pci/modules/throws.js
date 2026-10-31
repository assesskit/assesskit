"use strict";
define(["qtiCustomInteractionContext"], function (context) {
  context.register({
    typeIdentifier: "urn:test:throws",
    getInstance: function () {
      throw new Error("The factory fails.");
    },
  });
});
