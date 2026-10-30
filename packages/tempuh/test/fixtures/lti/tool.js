// A tool as 1EdTech's specifications describe one: it talks to the storage of the platform by LTI Client Side postMessages
// (lti-cs-pm) and LTI postMessage Storage (lti-pm-s), and tells the test what happened by requests to its own server, which the
// server records. The query names the origin of the platform's storage page, the name of its frame, the scenario and a token.
"use strict";
const query = new URLSearchParams(location.search);
const platform = query.get("platform");
const token = query.get("token");
const frame = query.get("frame");
const scenario = query.get("scenario");
const REPLY_MS = 1500;

const report = (step) => fetch(`/report/${token}/${step}`, { mode: "no-cors", cache: "no-store" }).catch(() => undefined);
const storage = () => window.parent.frames[frame];

/** Posts a request and waits for the response with the same message id; a response from another origin is counted and ignored. */
function ask(target, targetOrigin, message, expectedOrigin) {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const listener = (event) => {
      const data = event.data;
      if (typeof data !== "object" || data === null || data.message_id !== id) return;
      if (event.origin !== expectedOrigin) {
        report("wrong-origin");
        return;
      }
      window.removeEventListener("message", listener);
      window.clearTimeout(timer);
      resolve(data);
    };
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", listener);
      resolve(undefined);
    }, REPLY_MS);
    window.addEventListener("message", listener);
    target.postMessage({ ...message, message_id: id }, targetOrigin);
  });
}

const toStorage = (message) => ask(storage(), platform, message, platform);
const outcome = (response) => (response === undefined ? "silent" : (response.error ? `error-${response.error.code}` : `ok-${response.value ?? "empty"}`));

const scenarios = {
  async storage() {
    report(`put-${outcome(await toStorage({ subject: "lti.put_data", key: "state_a", value: "v1" }))}`);
    report(`get-${outcome(await toStorage({ subject: "lti.get_data", key: "state_a" }))}`);
    report(`missing-${outcome(await toStorage({ subject: "lti.get_data", key: "nothing" }))}`);
    report(`keyless-${outcome(await toStorage({ subject: "lti.put_data", value: "v" }))}`);
    report(`unsupported-${outcome(await toStorage({ subject: "lti.frameResize", height: 10 }))}`);
    report(`big-${outcome(await toStorage({ subject: "lti.put_data", key: "big", value: "x".repeat(4100) }))}`);
    report(`clear-${outcome(await toStorage({ subject: "lti.put_data", key: "state_a" }))}`);
    report(`cleared-${outcome(await toStorage({ subject: "lti.get_data", key: "state_a" }))}`);
    report("done");
  },
  async keys() {
    let last = "";
    for (let index = 0; index < 501; index += 1) last = outcome(await toStorage({ subject: "lti.put_data", key: `k${index}`, value: "v" }));
    report(`key-501-${last}`);
    report("done");
  },
  async write() {
    report(`write-${outcome(await toStorage({ subject: "lti.put_data", key: "state_a", value: "mine" }))}`);
    report("done");
  },
  async read() {
    report(`read-${outcome(await toStorage({ subject: "lti.get_data", key: "state_a" }))}`);
    report("done");
  },
  async capabilities() {
    const response = await ask(window.parent, "*", { subject: "lti.capabilities" }, query.get("player"));
    const subjects = response?.supported_messages?.map((each) => `${each.subject}@${each.frame ?? "parent"}`).join(",");
    report(`capabilities-${response?.subject}-${subjects}`);
    report("done");
  },
  async sandbox() {
    try {
      localStorage.setItem("probe", "1");
      report("origin-kept");
    } catch {
      report("origin-opaque");
    }
    report("done");
  },
};

report("loaded");
scenarios[scenario]?.();
