import { config } from "../config.js";
import type { Store } from "./Store.js";
import { SqliteStore } from "./sqlite.js";

let singleton: Store | undefined;

export function getStore(): Store {
  if (singleton) return singleton;
  switch (config.store) {
    case "sqlite":
      singleton = new SqliteStore(config.sqlitePath);
      break;
    case "dynamodb":
      throw new Error("DynamoDB store lands in Phase 3. Set STORE=sqlite for now.");
    default:
      throw new Error(`Unknown STORE: ${config.store as string}`);
  }
  return singleton;
}

export type { Store };
