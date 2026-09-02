/** Create the DynamoDB table (+ TTL) if it doesn't exist. Idempotent.
 *   STORE=dynamodb DYNAMODB_TABLE=wardrobe AWS_REGION=us-east-1 npm run aws:table
 * For local: also set DYNAMODB_ENDPOINT=http://localhost:8000 */
import { DynamoDBStore } from "../src/store/dynamodb.js";

const store = new DynamoDBStore();
await store.ensureTable();
console.log("DynamoDB table ready.");
