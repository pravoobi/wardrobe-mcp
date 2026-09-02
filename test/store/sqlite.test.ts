import { beforeEach, describe } from "vitest";
import { SqliteStore } from "../../src/store/sqlite.js";
import { storeContract } from "./contract.js";

describe("SqliteStore — Store contract", () => {
  let store: SqliteStore;
  beforeEach(() => {
    store = new SqliteStore(":memory:");
  });
  storeContract(() => store);
});
