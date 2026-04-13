import type { BaselineOperation } from "src/app/operations";
import type { PolicyResult } from "src/msl/gates/gates.interfaces";
import type { MslPolicyConfig } from "src/msl/config";
import { parseHost } from "src/msl/gates/shared";

// === Policy Gate ===
// Statische Governance auf Batch-Ebene, Kategorie infeasibility
// - Operation-Count vs maxOperationsPerCall
// - Delete-Count vs maxDeleteOperations
// - Payload-Bytes vs maxPayloadBytes
// - allowedExternalHosts für HTTP-Datasources (Pro-Op-Loop, Single-Source)
// Policy checkt bewusst keine Lock-Violation sondern das macht Preflight-Gate
export const evaluatePolicy = (
  operations: BaselineOperation[],
  config: MslPolicyConfig,
): PolicyResult => {
  const violations: string[] = [];

  if (operations.length > config.maxOperationsPerCall) {
    violations.push(
      `Operation count ${operations.length} exceeds maxOperationsPerCall ${config.maxOperationsPerCall}.`,
    );
  }

  const deleteCount = operations.filter(
    (operation) => operation.kind === "ui.remove_component",
  ).length;
  if (deleteCount > config.maxDeleteOperations) {
    violations.push(
      `Delete operation count ${deleteCount} exceeds maxDeleteOperations ${config.maxDeleteOperations}.`,
    );
  }

  if (config.allowedExternalHosts.length > 0) {
    for (const operation of operations) {
      if (operation.kind !== "integration.upsert_http_datasource") continue;
      const host = parseHost(operation.url);
      if (host && !config.allowedExternalHosts.includes(host)) {
        violations.push(
          `Externer Host '${host}' ist nicht in allowedExternalHosts.`,
        );
      }
    }
  }

  const payloadBytes = Buffer.byteLength(JSON.stringify(operations), "utf8");
  if (payloadBytes > config.maxPayloadBytes) {
    violations.push(
      `Operation payload ${payloadBytes} exceeds maxPayloadBytes ${config.maxPayloadBytes}.`,
    );
  }

  return { passed: violations.length === 0, violations };
};
