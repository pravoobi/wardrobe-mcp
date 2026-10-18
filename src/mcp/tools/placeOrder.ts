import { z } from "zod";
import { requireWrite, type ToolContext } from "../context.js";
import { toolResult, errorResult } from "../responses.js";
import { getGarment } from "../../catalog/catalog.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;

export const placeOrderSchema = {
  lookId: z.string().describe("The saved look to order — the garment, price and purchase link all come from it."),
  size: z.enum(SIZES).describe("The size to order."),
};

const Input = z.object(placeOrderSchema);
export type PlaceOrderInput = z.infer<typeof Input>;

function formatDeliveryDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", month: "long", day: "numeric" }).format(d);
}

/**
 * A simulated checkout: no real payment is taken and nothing ships. Real
 * purchasing is out of scope for this project (PCI-compliant payment
 * handling and real inventory/shipping are a different build entirely) —
 * this exists to give the voice flow a believable final beat without
 * pretending money moved, which is why the spoken reply says so plainly.
 */
export async function placeOrder(input: PlaceOrderInput, ctx: ToolContext): Promise<CallToolResult> {
  requireWrite(ctx.user);

  const look = await ctx.store.getLook(ctx.user.userId, input.lookId);
  if (!look) return errorResult(`I don't have a saved look called "${input.lookId}".`);

  const garment = getGarment(look.garmentId);
  if (!garment) return errorResult("I can't find the garment for that look anymore.");

  const orderId = `demo-order-${Date.now().toString(36)}`;
  const deliveryDate = formatDeliveryDate(5);

  return toolResult({
    text: `Order placed for the ${garment.meta.name}, size ${input.size} — arriving ${deliveryDate}. This is a simulated order; no real payment was made.`,
    structuredContent: {
      orderId,
      lookId: look.id,
      garmentId: look.garmentId,
      name: garment.meta.name,
      size: input.size,
      price: garment.meta.price,
      deliveryDate,
      simulated: true,
    },
  });
}
