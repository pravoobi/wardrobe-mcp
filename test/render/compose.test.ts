import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderLookCard, composeCompareSheet, LOOK_W, LOOK_H } from "../../src/render/compose.js";

const solid = (w: number, h: number, rgb: { r: number; g: number; b: number }) =>
  sharp({ create: { width: w, height: h, channels: 3, background: rgb } }).jpeg().toBuffer();

const garmentPng = () =>
  sharp({ create: { width: 400, height: 600, channels: 4, background: { r: 180, g: 40, b: 110, alpha: 1 } } })
    .png()
    .toBuffer();

describe("renderLookCard", () => {
  it("produces a WEBP at the look dimensions, under the inline cap", async () => {
    const webp = await renderLookCard({
      photo: await solid(700, 1000, { r: 90, g: 90, b: 90 }),
      garmentPng: await garmentPng(),
      name: "Magenta Wrap Maxi Dress",
      price: 4800,
      occasion: ["sangeet", "reception"],
      color: "magenta",
    });
    const meta = await sharp(webp).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(LOOK_W);
    expect(meta.height).toBe(LOOK_H);
    expect(webp.length).toBeLessThan(200 * 1024);
  });
});

describe("composeCompareSheet", () => {
  it("lays 2 cards side by side as one WEBP", async () => {
    const card = async (rgb: { r: number; g: number; b: number }) =>
      renderLookCard({
        photo: await solid(700, 1000, rgb),
        garmentPng: await garmentPng(),
        name: "X",
        color: "navy",
      });
    const sheet = await composeCompareSheet([
      { webp: await card({ r: 20, g: 30, b: 80 }), label: "magenta" },
      { webp: await card({ r: 80, g: 20, b: 20 }), label: "navy" },
    ]);
    const meta = await sharp(sheet).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width!).toBeGreaterThan(meta.height!); // landscape
    expect(sheet.length).toBeLessThan(200 * 1024);
  });
});
