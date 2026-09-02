import { beforeAll, describe } from "vitest";
import { storeContract } from "./contract.js";

/**
 * Runs the same Store contract against a real DynamoDB — set `DYNAMODB_ENDPOINT`
 * (e.g. DynamoDB Local) and `DYNAMODB_TABLE`. Skipped otherwise so CI stays
 * offline. See `npm run test:dynamo`.
 */
const endpoint = process.env.DYNAMODB_ENDPOINT;

describe.skipIf(!endpoint)("DynamoDBStore — Store contract", () => {
  // Import lazily so the AWS SDK isn't pulled in when skipped.
  let store: import("../../src/store/dynamodb.js").DynamoDBStore;

  beforeAll(async () => {
    process.env.STORE = "dynamodb";
    process.env.DYNAMODB_TABLE = process.env.DYNAMODB_TABLE ?? `wardrobe-test-${Date.now()}`;
    process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID ?? "local";
    process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY ?? "local";
    const { DynamoDBStore } = await import("../../src/store/dynamodb.js");
    store = new DynamoDBStore();
    await store.ensureTable();
  });

  storeContract(() => store);
});
