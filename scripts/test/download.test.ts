import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadText } from "../download.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the downloads of the scripts", () => {
  it("report each retry on the standard error and return what then arrives", async () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let calls = 0;
    const flaky: typeof fetch = async () =>
      calls++ === 0 ? new Response("", { status: 503 }) : new Response("served");
    expect(await downloadText("https://example.test/a", { fetch: flaky, retryMs: 1 })).toBe("served");
    expect(reported).toHaveBeenCalledExactlyOnceWith(
      "Downloading https://example.test/a failed: HTTP 503. Trying again (2 of 3).",
    );
  });

  it("report a retry to the function a caller gives instead", async () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const told: string[] = [];
    let calls = 0;
    const flaky: typeof fetch = async () =>
      calls++ === 0 ? new Response("", { status: 429 }) : new Response("served");
    await downloadText("https://example.test/b", {
      fetch: flaky,
      retryMs: 1,
      onRetry: (message) => told.push(message),
    });
    expect(told).toEqual(["Downloading https://example.test/b failed: HTTP 429. Trying again (2 of 3)."]);
    expect(reported).not.toHaveBeenCalled();
  });
});
