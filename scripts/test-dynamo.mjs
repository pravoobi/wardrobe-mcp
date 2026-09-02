// Store contract against DynamoDB Local. Cross-platform (no shell env-prefix).
//   npm run test:dynamo
import { spawnSync } from "node:child_process";

const name = "wardrobe-ddb";
// shell:true so Windows resolves the `docker` / `npx` .cmd shims.
const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { stdio: "inherit", shell: true, ...opts });

run("docker", ["rm", "-f", name]);
const up = run("docker", [
  "run", "-d", "--name", name, "-p", "8000:8000",
  "amazon/dynamodb-local", "-jar", "DynamoDBLocal.jar", "-inMemory",
]);
if (up.status !== 0) {
  console.error("Could not start DynamoDB Local — is Docker running?");
  process.exit(1);
}

// wait for it
const deadline = Date.now() + 20_000;
while (Date.now() < deadline) {
  try {
    await fetch("http://localhost:8000");
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}

const env = {
  ...process.env,
  DYNAMODB_ENDPOINT: "http://localhost:8000",
  AWS_ACCESS_KEY_ID: "local",
  AWS_SECRET_ACCESS_KEY: "local",
  AWS_REGION: "us-east-1",
};
const test = run("npx", ["vitest", "run", "test/store/dynamodb.test.ts"], { env });

run("docker", ["rm", "-f", name]);
process.exit(test.status ?? 1);
