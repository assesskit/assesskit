"use strict";
// Depends on ./helper, which RequireJS resolves against its baseUrl, the directory of this module under the prefix.
define(["qtiCustomInteractionContext", "./helper"], function (context, helper) {
  context.register({
    typeIdentifier: "urn:test:relative",
    getInstance: function (dom, configuration) {
      parent.postMessage({ probe: "relative", helper: helper.value }, "*");
      configuration.onready({}, "{}");
      return { typeIdentifier: "urn:test:relative", getResponse: function () {}, getState: function () { return "{}"; } };
    },
  });
});
