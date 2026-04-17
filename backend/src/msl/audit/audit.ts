import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const writeAuditEvent = async (
  dataDir: string,
  event: Record<string, unknown>,
): Promise<void> => {
  await mkdir(dataDir, { recursive: true });
  const auditPath = path.join(dataDir, "msl-audit.ndjson");
  await appendFile(auditPath, `${JSON.stringify(event)}\n`, "utf8");
};
