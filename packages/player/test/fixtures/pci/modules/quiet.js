"use strict";
// A portable custom interaction that counts presses of #press and fires no event: the player reads its response with
// getResponse, as the 1EdTech examples need.
define(["qtiCustomInteractionContext"], function (context) {
  context.register({
    typeIdentifier: "urn:test:quiet",
    getInstance: function (dom, configuration, state) {
      var count = state ? JSON.parse(state).count : 0;
      var instance = {
        typeIdentifier: "urn:test:quiet",
        getResponse: function () {
          return count === 0 ? undefined : { base: { integer: count } };
        },
        getState: function () {
          return JSON.stringify({ count: count });
        },
      };
      dom.addEventListener("click", function (event) {
        if (event.target.id === "press") count += 1;
      });
      // A test that sees no event clicks once the interaction listens.
      dom.setAttribute("data-ready", "");
      configuration.onready(instance, instance.getState());
      return instance;
    },
  });
});
