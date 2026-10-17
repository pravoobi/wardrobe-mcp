/**
 * Deterministic stand-in for the Bedrock reasoning step in `simulateApi.ts`,
 * used only when the real Bedrock call fails (see friction log #9 — the AWS
 * account is currently blocked from Bedrock account-wide). It implements the
 * exact same contract Bedrock's Converse API returns, so `web/app.ts`'s loop
 * never has to know which one answered — `simulateApi.ts` just tags the
 * response with `reasoner: "rule-based"` and the browser shows a small,
 * honest label. No LLM here: keyword matching over the fixed demo phrases
 * plus a few reasonable generalizations, using the conversation history
 * (past tool results) to resolve "the first one" / "that" / "them".
 *
 * This never pretends to be a real assistant — the moment Bedrock works
 * again, `simulateApi.ts` stops calling this at all.
 */

interface ContentBlock {
  text?: string;
  toolUse?: { toolUseId: string; name: string; input: unknown };
  toolResult?: { toolUseId: string; status?: "success" | "error"; content: { text?: string }[] };
}
interface ConvMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}
interface ReasonResult {
  message: ConvMessage;
  stopReason: "tool_use" | "end_turn";
}

interface SuggestOption {
  garmentId: string;
  name?: string;
}

interface HistoryContext {
  options: SuggestOption[];
  previewsSinceSuggest: number;
  lastPreviewedGarmentId?: string;
  savedLookIds: string[];
  savedLooks: { lookId: string; garmentId: string }[];
  nameByGarmentId: Record<string, string>;
}

function toolUseId(): string {
  return `rb_${Math.random().toString(36).slice(2, 10)}`;
}

function safeParse(text: string | undefined): { spoken?: string; structuredContent?: Record<string, unknown> } | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as { spoken?: string; structuredContent?: Record<string, unknown> };
  } catch {
    return undefined;
  }
}

function buildContext(messages: ConvMessage[]): HistoryContext {
  const toolNameByUseId = new Map<string, string>();
  const ctx: HistoryContext = {
    options: [],
    previewsSinceSuggest: 0,
    savedLookIds: [],
    savedLooks: [],
    nameByGarmentId: {},
  };

  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.toolUse) toolNameByUseId.set(block.toolUse.toolUseId, block.toolUse.name);
      if (!block.toolResult) continue;
      const name = toolNameByUseId.get(block.toolResult.toolUseId);
      const parsed = safeParse(block.toolResult.content[0]?.text);
      const sc = parsed?.structuredContent;
      if (!sc) continue;

      if (name === "suggest_outfits" && Array.isArray(sc.options)) {
        ctx.options = sc.options as SuggestOption[];
        ctx.previewsSinceSuggest = 0;
        for (const o of ctx.options) {
          if (o.name) ctx.nameByGarmentId[o.garmentId] = o.name;
        }
      } else if (name === "preview_look") {
        ctx.previewsSinceSuggest += 1;
        if (typeof sc.garmentId === "string") ctx.lastPreviewedGarmentId = sc.garmentId;
      } else if (name === "save_look" && typeof sc.lookId === "string") {
        ctx.savedLookIds.push(sc.lookId);
        if (Array.isArray(sc.looks)) {
          ctx.savedLooks = (sc.looks as { lookId: string; garmentId: string }[]).map((l) => ({
            lookId: l.lookId,
            garmentId: l.garmentId,
          }));
        }
      }
    }
  }
  return ctx;
}

/** Resolve "go with the magenta one" / "I like look 2" / "I love the first
 * one" etc. to a saved look: an explicit "look N" reference wins outright
 * (ids are literally "look-1", "look-2", ... — see Store.addLook), then a
 * garment-name word match, then falls back to the most recently saved look
 * when nothing names one specifically. */
function findReactionTarget(low: string, ctx: HistoryContext): string | undefined {
  const explicit = /\blook[\s-]?(\d+)\b/i.exec(low);
  if (explicit) {
    const id = `look-${explicit[1]}`;
    // Check the full saved-looks snapshot (from save_look's own structuredContent.looks),
    // not just savedLookIds — that list only grows from save_look calls seen in *this*
    // history and can miss looks saved earlier (e.g. before this conversation's window).
    if (ctx.savedLooks.some((sl) => sl.lookId === id) || ctx.savedLookIds.includes(id)) return id;
  }
  for (const sl of ctx.savedLooks) {
    const name = ctx.nameByGarmentId[sl.garmentId];
    if (!name) continue;
    const words = name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (words.some((w) => low.includes(w))) return sl.lookId;
  }
  return ctx.savedLookIds[ctx.savedLookIds.length - 1];
}

const OCCASIONS = [
  "sangeet",
  "wedding",
  "reception",
  "mehendi",
  "haldi",
  "cocktail",
  "party",
  "brunch",
  "office",
  "casual",
  "festive",
  "daytime",
  "date-night",
];
function findOccasion(text: string): string | undefined {
  const low = text.toLowerCase();
  return OCCASIONS.find((o) => new RegExp(`\\b${o}\\b`).test(low));
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};
function findBudget(text: string): number | undefined {
  const digits = /(?:₹|rs\.?|inr)?\s?(\d[\d,]{2,})/i.exec(text);
  if (digits) return Number(digits[1]!.replace(/,/g, ""));
  const words = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+thousand\b/i.exec(
    text.toLowerCase(),
  );
  if (words) return WORD_NUMBERS[words[1]!.toLowerCase()]! * 1000;
  return undefined;
}

const ORDINALS: Record<string, number> = { first: 0, second: 1, third: 2, "1st": 0, "2nd": 1, "3rd": 2 };
function findOptionIndex(text: string, ctx: HistoryContext): number | undefined {
  const low = text.toLowerCase();
  for (const [word, idx] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(low)) return idx;
  }
  if (/\b(another|next|different|other)\b/.test(low)) return ctx.previewsSinceSuggest % Math.max(ctx.options.length, 1);
  return undefined;
}

function toolUseMessage(name: string, input: Record<string, unknown>): ReasonResult {
  return {
    message: { role: "assistant", content: [{ toolUse: { toolUseId: toolUseId(), name, input } }] },
    stopReason: "tool_use",
  };
}
function textMessage(text: string): ReasonResult {
  return { message: { role: "assistant", content: [{ text }] }, stopReason: "end_turn" };
}

const CLARIFY = {
  noOptions:
    "I don't have any suggested outfits yet — try asking about an occasion first, like \"I have a sangeet, what should I wear?\"",
  noPreview: "I don't have a look on screen yet to save — ask me to show you something first.",
  notEnoughSaved: "You need at least two saved looks before I can compare them — save another one first.",
  noReactionTarget: "I don't have a saved look to react to yet — save one first.",
  unrecognized:
    "I'm using the offline demo reasoner right now, so I only understand a few things: asking about an occasion and budget, \"show me the first/second/another one\", \"save that\", \"compare them\", or how you felt about a look — like \"go with the magenta one\" or \"I don't like that one\".",
};

/**
 * Phase A: the last message is a fresh user utterance — decide which tool
 * to call. Phase B: the last message is a tool result — just relay the
 * tool's own (already voice-ready) `spoken` text as the final answer.
 */
export function reason(messages: ConvMessage[], _tools: unknown[]): ReasonResult {
  const last = messages[messages.length - 1];
  if (!last) return textMessage(CLARIFY.unrecognized);

  const toolResults = last.content.filter((b) => b.toolResult);
  if (toolResults.length > 0) {
    const spoken = toolResults
      .map((b) => safeParse(b.toolResult!.content[0]?.text)?.spoken)
      .filter((s): s is string => Boolean(s));
    return textMessage(spoken.join(" ") || "Done.");
  }

  const utterance = last.content.find((b) => b.text)?.text ?? "";
  const low = utterance.toLowerCase();
  const ctx = buildContext(messages);

  const occasion = findOccasion(low);
  if (occasion && /\b(wear|outfit|suggest|options?|dress)\b/.test(low) || (occasion && findBudget(low) !== undefined)) {
    const budget = findBudget(low);
    return toolUseMessage("suggest_outfits", budget !== undefined ? { occasion, budget } : { occasion });
  }

  if (/\bcompare\b/.test(low)) {
    if (ctx.savedLookIds.length < 2) return textMessage(CLARIFY.notEnoughSaved);
    return toolUseMessage("compare_looks", { lookIds: ctx.savedLookIds.slice(-3) });
  }

  if (/\bsave\b/.test(low)) {
    if (!ctx.lastPreviewedGarmentId) return textMessage(CLARIFY.noPreview);
    return toolUseMessage("save_look", { garmentId: ctx.lastPreviewedGarmentId });
  }

  if (/\b(love|amazing|perfect|beautiful|go with|go for|choose|chose|pick|i'?ll take|i like)\b/.test(low)) {
    const lookId = findReactionTarget(low, ctx);
    if (!lookId) return textMessage(CLARIFY.noReactionTarget);
    return toolUseMessage("record_reaction", { lookId, reaction: "love" });
  }
  if (/\b(reject|no thanks|not (this|that) one|hate)\b/.test(low)) {
    const lookId = findReactionTarget(low, ctx);
    if (!lookId) return textMessage(CLARIFY.noReactionTarget);
    return toolUseMessage("record_reaction", { lookId, reaction: "reject" });
  }

  const idx = findOptionIndex(low, ctx);
  if (idx !== undefined || /\b(show|preview|see it|on me)\b/.test(low)) {
    if (ctx.options.length === 0) return textMessage(CLARIFY.noOptions);
    const chosen = ctx.options[idx ?? ctx.previewsSinceSuggest % ctx.options.length] ?? ctx.options[0]!;
    return toolUseMessage("preview_look", { garmentId: chosen.garmentId });
  }

  if (/\b(my wardrobe|what (do|did) i (own|have)|what's in my wardrobe)\b/.test(low)) {
    return toolUseMessage("list_wardrobe", {});
  }
  if (/\b(saved looks|what have i saved|list.*looks)\b/.test(low)) {
    return toolUseMessage("list_looks", {});
  }
  if (/\b(search|find|catalog)\b/.test(low)) {
    const budget = findBudget(low);
    const input: Record<string, unknown> = {};
    if (occasion) input.occasion = occasion;
    if (budget !== undefined) input.maxPrice = budget;
    return toolUseMessage("search_catalog", input);
  }

  return textMessage(CLARIFY.unrecognized);
}
