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

  await store.addPhoto({
    id: "photo-1",
    userId: DEMO_USER,
    s3Key: "seed/praveen-primary.jpg",
    width: 768,
    height: 1152,
    isPrimary: true,
  });

  const owned = ["kurta-white-chikankari", "nehru-jacket-emerald"];
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

  // Pre-render the demo user's photo against the whole catalog.
  for (const g of catalog) {
    await render.enqueue({ userId: DEMO_USER, photoId: "photo-1", garmentId: g.id });
  }

  // Give the stub worker a tick to drain.
  await new Promise((r) => setTimeout(r, 200));

  const looks = await store.listLooks(DEMO_USER);
  console.log(`Seeded ${DEMO_USER}: photo-1, ${owned.length} wardrobe items, ${catalog.length} renders queued, ${looks.length} looks.`);
  console.log(`Dev token: dev_${DEMO_USER}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
