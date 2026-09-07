import { describe, expect, it } from "vitest";
import { reason } from "../../src/web/ruleReasoner.js";

interface ContentBlock {
  text?: string;
  toolUse?: { toolUseId: string; name: string; input: unknown };
  toolResult?: { toolUseId: string; status?: "success" | "error"; content: { text?: string }[] };
}
interface ConvMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

const user = (text: string): ConvMessage => ({ role: "user", content: [{ text }] });

/** Simulates what web/app.ts does after a real tool call: push the assistant's
 * toolUse (as the rule reasoner itself would have produced it) then the
 * browser's toolResult reply, so later turns can resolve context from history. */
function withToolRoundTrip(
  messages: ConvMessage[],
  name: string,
  input: unknown,
  spoken: string,
  structuredContent: Record<string, unknown>,
): ConvMessage[] {
  const toolUseId = "t1";
  return [
    ...messages,
    { role: "assistant", content: [{ toolUse: { toolUseId, name, input } }] },
    {
      role: "user",
      content: [{ toolResult: { toolUseId, status: "success", content: [{ text: JSON.stringify({ spoken, structuredContent }) }] } }],
    },
  ];
}

describe("ruleReasoner: intent parsing (fresh utterance)", () => {
  it("suggest_outfits: occasion + digit budget", () => {
    const r = reason([user("I have a sangeet on Saturday. What should I wear? Budget 8000.")], []);
    expect(r.stopReason).toBe("tool_use");
    expect(r.message.content[0]!.toolUse).toMatchObject({ name: "suggest_outfits", input: { occasion: "sangeet", budget: 8000 } });
  });

  it("suggest_outfits: word-form budget ('eight thousand')", () => {
    const r = reason([user("I have a sangeet on Saturday. What should I wear? Budget eight thousand.")], []);
    expect(r.message.content[0]!.toolUse!.input).toMatchObject({ occasion: "sangeet", budget: 8000 });
  });

  it("suggest_outfits: comma-formatted budget", () => {
    const r = reason([user("sangeet outfit, budget ₹12,500")], []);
    expect(r.message.content[0]!.toolUse!.input).toMatchObject({ occasion: "sangeet", budget: 12500 });
  });

  it("suggest_outfits: occasion with no budget still fires with a wear/outfit keyword", () => {
    const r = reason([user("what should I wear to a mehendi")], []);
    expect(r.message.content[0]!.toolUse).toMatchObject({ name: "suggest_outfits", input: { occasion: "mehendi" } });
  });

  it("preview_look: 'first one' needs prior options in context", () => {
    const r = reason([user("show me the first one on me")], []);
    expect(r.stopReason).toBe("end_turn");
    expect(r.message.content[0]!.text).toMatch(/don't have any suggested outfits/i);
  });

  it("save_look: no prior preview clarifies instead of guessing", () => {
    const r = reason([user("save that")], []);
    expect(r.stopReason).toBe("end_turn");
    expect(r.message.content[0]!.text).toMatch(/don't have a look on screen/i);
  });

  it("compare_looks: fewer than two saved looks clarifies", () => {
    const r = reason([user("compare them")], []);
    expect(r.message.content[0]!.text).toMatch(/at least two saved looks/i);
  });

  it("falls back to a helpful clarification for unrecognized text", () => {
    const r = reason([user("what's the weather like in paris")], []);
    expect(r.stopReason).toBe("end_turn");
    expect(r.message.content[0]!.text).toMatch(/offline demo reasoner/i);
  });
});

describe("ruleReasoner: phase B — relaying a tool result's spoken text", () => {
  it("echoes the tool's own spoken text verbatim as the final answer", () => {
    const messages = withToolRoundTrip(
      [user("I have a sangeet, budget 8000")],
      "suggest_outfits",
      { occasion: "sangeet", budget: 8000 },
      "Here are three options for your sangeet.",
      { occasion: "sangeet", options: [{ garmentId: "g1", name: "Magenta Set" }] },
    );
    const r = reason(messages, []);
    expect(r.stopReason).toBe("end_turn");
    expect(r.message.content[0]!.text).toBe("Here are three options for your sangeet.");
  });
});

describe("ruleReasoner: the full sangeet flow, turn by turn", () => {
  it("suggest -> preview first -> save -> preview another -> save -> compare", () => {
    let messages: ConvMessage[] = [];

    // 1. suggest_outfits
    messages.push(user("I have a sangeet on Saturday. What should I wear? Budget eight thousand."));
    let r = reason(messages, []);
    expect(r.message.content[0]!.toolUse).toMatchObject({ name: "suggest_outfits" });
    messages = withToolRoundTrip(
      messages,
      "suggest_outfits",
      { occasion: "sangeet", budget: 8000 },
      "Here are three options.",
      {
        occasion: "sangeet",
        options: [
          { garmentId: "g1", name: "Magenta Set" },
          { garmentId: "g2", name: "Navy Set" },
          { garmentId: "g3", name: "Gold Set" },
        ],
      },
    );

    // 2. "Show me the first one on me."
    messages.push(user("Show me the first one on me."));
    r = reason(messages, []);
    expect(r.message.content[0]!.toolUse).toMatchObject({ name: "preview_look", input: { garmentId: "g1" } });
    messages = withToolRoundTrip(messages, "preview_look", { garmentId: "g1" }, "Here's Magenta Set on you.", { garmentId: "g1" });

    // 3. "Save that."
    messages.push(user("Save that."));
    r = reason(messages, []);
    expect(r.message.content[0]!.toolUse).toMatchObject({ name: "save_look", input: { garmentId: "g1" } });
    messages = withToolRoundTrip(messages, "save_look", { garmentId: "g1" }, "Saved as look-1.", { lookId: "look-1" });

    // 4. "Now show me another option."
    messages.push(user("Now show me another option."));
    r = reason(messages, []);
    expect(r.message.content[0]!.toolUse).toMatchObject({ name: "preview_look", input: { garmentId: "g2" } });
    messages = withToolRoundTrip(messages, "preview_look", { garmentId: "g2" }, "Here's Navy Set on you.", { garmentId: "g2" });

    // 5. "Save that." again — should now target g2, not g1.
    messages.push(user("Save that."));
    r = reason(messages, []);
    expect(r.message.content[0]!.toolUse).toMatchObject({ name: "save_look", input: { garmentId: "g2" } });
    messages = withToolRoundTrip(messages, "save_look", { garmentId: "g2" }, "Saved as look-2.", { lookId: "look-2" });

    // 6. "Compare them."
    messages.push(user("Compare them."));
    r = reason(messages, []);
    expect(r.message.content[0]!.toolUse).toMatchObject({ name: "compare_looks", input: { lookIds: ["look-1", "look-2"] } });
  });
});
