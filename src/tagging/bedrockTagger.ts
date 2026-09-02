import type { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { config } from "../config.js";
import { GarmentTagSchema, type GarmentTag, type Tagger } from "./tagger.js";

const SYSTEM = `You tag Indian ethnic-wear garment photos for a wardrobe app.
Reply with ONLY a JSON object, no prose, matching:
{ "name": string, "color": string, "category": string, "occasion": string[] }
- name: 3-6 words, e.g. "Magenta Bandhani Silk Kurta Set"
- color: the dominant colour, one word
- category: one of dress, kurti, kurta-set, sherwani, lehenga-choli, nehru-jacket, saree, bandhgala
- occasion: 1-4 of sangeet, mehendi, haldi, wedding, reception, festive, party, cocktail, brunch, daytime, office, casual`;

type Invoke = (image: Buffer, mimeType: string) => Promise<string>;

/**
 * The **only** LLM call in the system. Runs once, at garment-upload time in the
 * companion UI — never inside an MCP tool call. Turns a photo into
 * `{ name, color, category, occasion[] }` so the item is findable by voice.
 */
export class BedrockTagger implements Tagger {
  private readonly invoke: Invoke;

  constructor(deps: { invoke?: Invoke; client?: BedrockRuntimeClient } = {}) {
    this.invoke = deps.invoke ?? this.bedrockInvoke.bind(this, deps.client);
  }

  async tag(image: Buffer, mimeType: string): Promise<GarmentTag> {
    const text = await this.invoke(image, mimeType);
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    return GarmentTagSchema.parse(JSON.parse(json));
  }

  private async bedrockInvoke(
    injected: BedrockRuntimeClient | undefined,
    image: Buffer,
    mimeType: string,
  ): Promise<string> {
    const { BedrockRuntimeClient, ConverseCommand } = await import("@aws-sdk/client-bedrock-runtime");
    const client = injected ?? new BedrockRuntimeClient({ region: config.awsRegion });
    const format = mimeType.split("/")[1] as "jpeg" | "png" | "webp" | "gif";
    const res = await client.send(
      new ConverseCommand({
        modelId: config.bedrockModelId,
        system: [{ text: SYSTEM }],
        messages: [
          {
            role: "user",
            content: [
              { image: { format, source: { bytes: image } } },
              { text: "Tag this garment." },
            ],
          },
        ],
        inferenceConfig: { maxTokens: 250, temperature: 0 },
      }),
    );
    return res.output?.message?.content?.[0]?.text ?? "";
  }
}
