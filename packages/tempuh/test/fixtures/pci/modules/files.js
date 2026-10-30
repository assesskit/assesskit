"use strict";
// A portable custom interaction that gives files. It reports the response variable it receives, in messages the player
// ignores. #give makes a new file at each press, #same the same file, and #bad a response that is not an integer.
define(["qtiCustomInteractionContext"], function (context) {
  context.register({
    typeIdentifier: "urn:test:files",
    getInstance: function (dom, configuration) {
      var given = 0;
      var current;
      var instance = {
        typeIdentifier: "urn:test:files",
        getResponse: function () {
          return current;
        },
        getState: function () {
          return JSON.stringify({ given: given });
        },
      };
      function change(response) {
        current = response;
        dom.dispatchEvent(new CustomEvent("qti-interaction-changed", { bubbles: true, detail: { interaction: instance } }));
      }
      dom.addEventListener("click", function (event) {
        if (event.target.id === "give") {
          given += 1;
          change({ base: { file: { data: btoa("file " + given), mime: "text/plain", name: "f" + given + ".txt" } } });
        } else if (event.target.id === "same") {
          change({ base: { file: { data: btoa("same"), mime: "text/plain", name: "same.txt" } } });
        } else if (event.target.id === "bad") {
          change({ base: { integer: "x" } });
        }
      });
      parent.postMessage({ probe: "instance", boundTo: configuration.boundTo }, "*");
      configuration.onready(instance, instance.getState());
      return instance;
    },
  });
});
