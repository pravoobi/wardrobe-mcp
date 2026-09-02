import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface ResultInput {
  /** One or two sentences Alexa+ can read aloud verbatim. */
  text: string;
  structuredContent: Record<string, unknown>;
  /** base64 WEBP (no data: prefix), ≤ ~200 KB. Screen devices only. */
  imageBase64?: string;
  imageMimeType?: string;
  isError?: boolean;
}

/**
 * Every tool returns a speakable `text` block plus `structuredContent`.
 * Image-returning tools add an `image` block; the HTTPS URL still lives in
 * `structuredContent` because some clients drop inline images.
 */
export function toolResult(input: ResultInput): CallToolResult {
  const content: CallToolResult["content"] = [{ type: "text", text: input.text }];
  if (input.imageBase64) {
    content.push({
      type: "image",
      data: input.imageBase64,
      mimeType: input.imageMimeType ?? "image/webp",
    });
  }
  return {
    content,
    structuredContent: input.structuredContent,
    isError: input.isError ?? false,
  };
}

export function errorResult(text: string, structuredContent: Record<string, unknown> = {}): CallToolResult {
  return toolResult({ text, structuredContent: { error: text, ...structuredContent }, isError: true });
}
