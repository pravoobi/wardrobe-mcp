import sharp, { type OverlayOptions } from "sharp";

export const LOOK_W = 720;
export const LOOK_H = 960;
const WEBP = { quality: 78, effort: 4 } as const;

export interface LookInput {
  photo: Buffer;
  garmentPng: Buffer;
  name: string;
  price?: number;
  occasion?: string[];
  color?: string;
}

const esc = (s: string): string =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&#39;", '"': "&quot;" })[c]!);

/**
 * A wardrobe "look" card: the customer's photo full-bleed, the flat garment
 * shown as a chip, and a caption bar. This is a fast, honest stand-in for the
 * browser try-on render (see worker.ts) — it pairs the garment with the person
 * rather than warping it onto their body. Screen devices show this; voice
 * devices get the spoken text.
 */
const SWATCH: Record<string, string> = {
  magenta: "#c8286f",
  navy: "#22305a",
  green: "#2f8f52",
  pink: "#e08bb0",
  red: "#a83341",
  cream: "#d8c9a6",
  indigo: "#4b47a0",
};

export async function renderLookCard(input: LookInput): Promise<Buffer> {
  const base = await sharp(input.photo)
    .resize(LOOK_W, LOOK_H, { fit: "cover", position: "top" })
    .toBuffer();

  // Garment thumbnail on a mid-tone card so light garments still read.
  const chipW = 190;
  const chipH = 250;
  const garment = await sharp(input.garmentPng)
    .resize(chipW - 24, chipH - 24, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const chip = await sharp({
    create: { width: chipW, height: chipH, channels: 4, background: "#e9e4d9" },
  })
    .composite([{ input: garment, gravity: "centre" }])
    .png()
    .toBuffer();

  const accent = SWATCH[(input.color ?? "").toLowerCase()] ?? "#8a8a8a";
  const priceStr = input.price ? `₹${input.price.toLocaleString("en-IN")}` : "";
  const occStr = (input.occasion ?? []).slice(0, 3).join(" · ");

  const overlay = Buffer.from(
    `<svg width="${LOOK_W}" height="${LOOK_H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#000" stop-opacity="0.74"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="10" height="${LOOK_H}" fill="${accent}"/>
      <rect x="0" y="${LOOK_H - 210}" width="${LOOK_W}" height="210" fill="url(#g)"/>
      <rect x="${LOOK_W - chipW - 22}" y="22" width="${chipW}" height="${chipH}" rx="14" fill="#000" fill-opacity="0.15"/>
      <text x="30" y="${LOOK_H - 92}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="#fff">${esc(
        input.name,
      )}</text>
      <text x="30" y="${LOOK_H - 54}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="23" fill="#e8e8e8">${esc(
        [priceStr, occStr].filter(Boolean).join("   ·   "),
      )}</text>
      <text x="30" y="${LOOK_H - 22}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="15" fill="#bcbcbc" letter-spacing="2">WARDROBE PREVIEW</text>
    </svg>`,
  );

  return sharp(base)
    .composite([
      { input: chip, top: 26, left: LOOK_W - chipW - 18 },
      { input: overlay, top: 0, left: 0 },
    ])
    .webp(WEBP)
    .toBuffer();
}

export interface CompareCard {
  webp: Buffer;
  label: string;
}

/** Side-by-side compare sheet from already-rendered look cards. One SVG
 * rasterization (background + every label) plus the resized photos on top —
 * librsvg is the slow part, so we call it once. */
export async function composeCompareSheet(cards: CompareCard[]): Promise<Buffer> {
  const n = Math.max(1, Math.min(3, cards.length));
  const cellW = 480;
  const cellH = Math.round((cellW / LOOK_W) * LOOK_H);
  const pad = 20;
  const labelH = 52;
  const sheetW = pad + n * (cellW + pad);
  const sheetH = pad * 2 + cellH + labelH;

  const labels = cards
    .slice(0, n)
    .map((card, i) => {
      const cx = pad + i * (cellW + pad) + cellW / 2;
      return `<text x="${cx}" y="${pad + cellH + 36}" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="26" font-weight="600" fill="#1a1a1a">${esc(
        card.label,
      )}</text>`;
    })
    .join("");
  const bg = Buffer.from(
    `<svg width="${sheetW}" height="${sheetH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${sheetW}" height="${sheetH}" fill="#f4f2ee"/>${labels}
    </svg>`,
  );

  const photos: OverlayOptions[] = [];
  for (let i = 0; i < n; i++) {
    const img = await sharp(cards[i]!.webp).resize(cellW, cellH, { fit: "cover" }).toBuffer();
    photos.push({ input: img, top: pad, left: pad + i * (cellW + pad) });
  }

  return sharp(bg).composite(photos).webp(WEBP).toBuffer();
}
