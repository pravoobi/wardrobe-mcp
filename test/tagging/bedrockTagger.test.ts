import { describe, expect, it } from "vitest";
import { BedrockTagger } from "../../src/tagging/bedrockTagger.js";
import { NoneTagger } from "../../src/tagging/tagger.js";

describe("BedrockTagger", () => {
  it("parses a well-formed JSON reply (even wrapped in prose)", async () => {
    const tagger = new BedrockTagger({
      invoke: async () =>
        'Here you go:\n{ "name": "Magenta Bandhani Kurta Set", "color": "magenta", "category": "kurta-set", "occasion": ["sangeet", "mehendi"] }\nHope that helps.',
    });
    const tag = await tagger.tag(Buffer.from("x"), "image/jpeg");
    expect(tag).toEqual({
      name: "Magenta Bandhani Kurta Set",
      color: "magenta",
      category: "kurta-set",
      occasion: ["sangeet", "mehendi"],
    });
  });

  it("rejects a reply that doesn't match the schema", async () => {
    const tagger = new BedrockTagger({ invoke: async () => '{ "name": "x" }' });
    await expect(tagger.tag(Buffer.from("x"), "image/png")).rejects.toThrow();
  });
});

describe("NoneTagger", () => {
  it("throws a helpful message when tagging is disabled", async () => {
    await expect(new NoneTagger().tag()).rejects.toThrow(/disabled/i);
  });
});
