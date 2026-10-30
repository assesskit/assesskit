"use strict";
// A portable custom interaction that counts presses of #press. It reports what it receives, in messages the player
// ignores, so that a test can read what a frame of an opaque origin holds.
define(["qtiCustomInteractionContext"], function (context) {
  var calls = [];
  function report(probe, data) {
    parent.postMessage(Object.assign({ probe: probe }, data), "*");
  }
  context.register({
    typeIdentifier: "urn:test:simple",
    getInstance: function (dom, configuration, state) {
      var count = state ? JSON.parse(state).count : 0;
      var instance = {
        typeIdentifier: "urn:test:simple",
        message: "",
        getResponse: function () {
          calls.push("getResponse");
          return count === 0 ? undefined : { base: { integer: count } };
        },
        getState: function () {
          calls.push("getState");
          return JSON.stringify({ count: count });
        },
        oncompleted: function () {
          calls.push("oncompleted");
          report("oncompleted", { calls: calls.slice() });
        },
        checkValidity: function () {
          return count > 0;
        },
        reportValidity: function () {
          report("reportValidity", {});
          return count > 0;
        },
        setCustomValidity: function (message) {
          instance.message = message;
        },
        getCustomValidity: function () {
          return instance.message;
        },
      };
      dom.addEventListener("click", function (event) {
        if (event.target.id === "press") {
          count += 1;
          dom.dispatchEvent(
            new CustomEvent("qti-interaction-changed", {
              bubbles: true,
              cancelable: true,
              detail: {
                interaction: instance,
                responseIdentifier: configuration.responseIdentifier,
                valid: true,
                value: instance.getResponse(),
              },
            }),
          );
        } else if (event.target.id === "done") {
          configuration.ondone(instance, instance.getResponse(), instance.getState(), "solution");
        }
      });
      dom.addEventListener("focusin", function (event) {
        report("focus", { id: event.target.id });
      });
      var press = dom.querySelector("#press");
      report("instance", {
        configuration: {
          properties: configuration.properties,
          templateVariables: configuration.templateVariables,
          contextVariables: configuration.contextVariables,
          boundTo: configuration.boundTo,
          responseIdentifier: configuration.responseIdentifier,
          status: configuration.status,
        },
        state: state === undefined ? null : state,
        className: dom.className,
        markup: dom.innerHTML,
        language: document.documentElement.lang,
        title: document.title,
        rootColor: getComputedStyle(document.documentElement).color,
        color: press ? getComputedStyle(press).color : null,
      });
      configuration.onready(instance, instance.getState());
      return instance;
    },
  });
});
