import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonRecord } from "src/shared/utils";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(
  __dirname,
  "fixtures/customer-portal-baseline.json",
);

let cached: JsonRecord | undefined;

const loadRaw = (): JsonRecord => {
  if (!cached) {
    const raw = readFileSync(FIXTURE_PATH, "utf-8");
    cached = JSON.parse(raw) as JsonRecord;
  }
  return cached;
};

export const loadBaselineDsl = (): JsonRecord => structuredClone(loadRaw());
