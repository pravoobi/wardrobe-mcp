import type { Hono } from "hono";
import { z } from "zod";
import type { BedrockRuntimeClient, Message, Tool } from "@aws-sdk/client-bedrock-runtime";
import { config } from "../config.js";

/**
 * The reasoning step for the Phase 5 simulated Alexa+ web app
 * (`web/simulator.html`). This is the **only** place besides `bedrockTagger.ts`
 * that calls an LLM, and — like that one — it never touches the wardrobe data
 * itself. It just decides which MCP tool to call next; the browser executes
 * the actual tool call against the real `/mcp` endpoint with the user's own
 * Bearer token, then posts the result back here for the next turn. Stateless:
 * the full conversation is round-tripped every call.
 */
const SYSTEM = `You are Alexa+, a warm, concise voice stylist speaking to a customer through a
smart speaker with a screen (an Echo Show). You have wardrobe tools: use them rather than
guessing. Keep spoken replies to 1-3 short sentences — they will be read aloud, not displayed
as a document. When you show the customer an image (a preview or a comparison), say so
naturally ("Here's how it looks on you") rather than describing pixels. Never invent prices,
garments, or looks that a tool didn't return. If a tool says it's still rendering, tell the
customer to give you a moment and don't retry immediately.`;

const ContentBlock = z
  .object({
    text: z.string().optional(),
    toolUse: z
      .object({ toolUseId: z.string(), name: z.string(), input: z.unknown() })
      .optional(),
    toolResult: z
      .object({
        toolUseId: z.string(),
        status: z.enum(["success", "error"]).optional(),
        content: z.array(z.object({ text: z.string().optional() })),
      })
      .optional(),
  })
  .passthrough();

const TurnRequest = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.array(ContentBlock).min(1),
      }),
    )
    .min(1),
  tools: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        inputSchema: z.record(z.unknown()).optional(),
      }),
    )
    .default([]),
});

function toBedrockTools(tools: z.infer<typeof TurnRequest>["tools"]): Tool[] {
  return tools.map(
    (t) =>
      ({
        toolSpec: {
          name: t.name,
          description: t.description,
          inputSchema: { json: t.inputSchema ?? { type: "object", properties: {} } },
        },
      }) as Tool,
  );
}

export function mountSimulatorApi(
  app: Hono,
  bearerAuth: import("hono").MiddlewareHandler,
  deps: { client?: BedrockRuntimeClient } = {},
): void {
  app.post("/api/simulate/turn", bearerAuth, async (c) => {
    const parsed = TurnRequest.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      return c.json({ error: "invalid_request", details: parsed.error.flatten() }, 400);
    }
    const { messages, tools } = parsed.data;

    const { BedrockRuntimeClient, ConverseCommand } = await import("@aws-sdk/client-bedrock-runtime");
    const client = deps.client ?? new BedrockRuntimeClient({ region: config.awsRegion });

    try {
      const res = await client.send(
        new ConverseCommand({
          modelId: config.bedrockModelId,
          system: [{ text: SYSTEM }],
          messages: messages as Message[],
          toolConfig: tools.length ? { tools: toBedrockTools(tools) } : undefined,
          inferenceConfig: { maxTokens: 400, temperature: 0.3 },
        }),
      );
      return c.json({ message: res.output?.message ?? { role: "assistant", content: [] }, stopReason: res.stopReason });
    } catch (err) {
      return c.json(
        { error: "bedrock_error", message: err instanceof Error ? err.message : String(err) },
        502,
      );
    }
  });
}
