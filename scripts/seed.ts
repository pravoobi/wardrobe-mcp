/** Seed a demo user "Praveen" with a photo, a small wardrobe, and pre-rendered
 * looks so the sangeet demo boots warm. Run: npm run seed */
import { getStore } from "../src/store/index.js";
import { RenderQueue } from "../src/render/queue.js";
import { catalog } from "../src/catalog/catalog.js";

const DEMO_USER = "praveen";

async function main(): Promise<void> {
  const store = getStore();
  const render = new RenderQueue(store);

  await store.upsertUser({
    id: DEMO_USER,
    displayName: "Praveen",
    createdAt: new Date().toISOString(),
  });

  // Primary photo: the try-on app's bundled test photo. Swap for a real upload
  // via the companion UI (Phase 6). `tryon:<id>` is resolved by the renderer.
  await store.addPhoto({
    id: "photo-1",
    userId: DEMO_USER,
    s3Key: "tryon:photo-01",
    width: 768,
    height: 1152,
    isPrimary: true,
  });

  const owned = ["kurti-cream-embroidered-01", "dress-green-floral-01"];
  for (const garmentId of owned) {
    const g = catalog.find((x) => x.id === garmentId);
    if (!g) continue;
    await store.addWardrobeItem({
      id: `w-${DEMO_USER}-${garmentId}`,
      userId: DEMO_USER,
      garmentId,
      source: "catalog",
      addedAt: new Date().toISOString(),
      meta: { ...g.meta, category: g.category },
    });
  }

  // Pre-render the demo user's photo against the whole catalog so every
  // preview_look is a warm cache hit.
  console.log(`Rendering ${catalog.length} looks (mode: ${process.env.RENDER_MODE ?? "local"})...`);
  const t0 = performance.now();
  for (const g of catalog) {
    await render.enqueue({ userId: DEMO_USER, photoId: "photo-1", garmentId: g.id });
  }
  // RENDER_MODE=browser: 8 real try-on renders, correctly waited for, can
  // exceed 120s total (each includes a full canvas-stability wait, not just
  // "did it click ok") — 120s was cutting the last couple off mid-render and
  // marking them "failed" purely from the timeout closing the browser
  // underneath them, not a real failure.
  await render.settle(240_000);
  await render.close();

  console.log(
    `Seeded ${DEMO_USER}: photo-1, ${owned.length} wardrobe items, ${catalog.length} looks rendered in ${((performance.now() - t0) / 1000).toFixed(1)}s.`,
  );
  console.log(`Dev token: dev_${DEMO_USER}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
