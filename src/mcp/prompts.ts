import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerWardrobePrompts(server: McpServer): void {
  server.registerPrompt(
    "style_me",
    {
      title: "Style me for an occasion",
      description: "Run the stylist loop: suggest → preview → reaction → save → compare.",
      argsSchema: {
        user: z.string().describe("The customer's name."),
        occasion: z.string().describe("What they're dressing for."),
        budget: z.string().optional().describe("Budget, spoken (e.g. 'eight thousand rupees')."),
      },
    },
    ({ user, occasion, budget }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Style ${user} for ${occasion}${budget ? ` under ${budget}` : ""}.`,
              "Call suggest_outfits first and read the three options aloud with their reasons.",
              "When they pick one, call preview_look and ask how it looks — only they can judge fit.",
              "On a positive reaction call save_look. If they want to see another, preview it too.",
              "When two looks are saved, offer compare_looks. Record the final choice with record_reaction and read out the purchase link.",
            ].join(" "),
          },
        },
      ],
    }),
  );
}
