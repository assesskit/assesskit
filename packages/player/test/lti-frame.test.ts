// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages are snake_case.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { answerCapabilities } from "../src/player/lti-frame/internal.js";

describe("answerCapabilities", () => {
  it("answers a capabilities request as the specification shows it, naming the frame of the storage page", () => {
    expect(answerCapabilities({ subject: "lti.capabilities", message_id: "12345" })).toEqual({
      message_id: "12345",
      subject: "lti.capabilities.response",
      supported_messages: [
        { subject: "lti.capabilities" },
        { subject: "lti.put_data", frame: "lti-storage" },
        { subject: "lti.get_data", frame: "lti-storage" },
      ],
    });
  });

  it("answers nothing to a message that is not a capabilities request", () => {
    const messages = [
      JSON.parse("null"),
      JSON.parse("[]"),
      JSON.parse('"lti.capabilities"'),
      { subject: "lti.put_data", message_id: "1", key: "k", value: "v" },
      { subject: "lti.capabilities" },
      { subject: "lti.capabilities", message_id: 5 },
      { message_id: "1" },
    ];
    for (const message of messages) expect(answerCapabilities(message)).toBeUndefined();
  });

  it("echoes the message id of any request", () => {
    fc.assert(
      fc.property(fc.string(), (id) => {
        expect(answerCapabilities({ subject: "lti.capabilities", message_id: id })).toMatchObject({
          message_id: id,
          subject: "lti.capabilities.response",
        });
      }),
    );
  });
});
