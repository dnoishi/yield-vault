import { existsSync } from "node:fs";
import { config } from "dotenv";

const candidates = [
  process.env.ENV_FILE,
  "operator/.env.local",
  ".env.local",
  ".env",
  "../.env",
].filter((value): value is string => Boolean(value));

const path = candidates.find((candidate) => existsSync(candidate));
if (path) config({ path });
