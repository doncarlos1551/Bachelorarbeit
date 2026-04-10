import "dotenv/config";
import { LowcoderClient } from "src/adapters/lowcoder/client";
import { loadBaselineDsl } from "src/study/fixture-loader";
import { isRecord } from "src/shared/utils";

const TEMPLATE_NAME = "Study Template - Customer Portal";

async function main() {
  const client = LowcoderClient.fromEnv();
  console.log("=== Study Template Seed (Fixture-Push) ===");

  const fixture = loadBaselineDsl();
  const items =
    isRecord(fixture.ui) &&
    isRecord((fixture.ui as Record<string, unknown>).items)
      ? (fixture.ui as { items: Record<string, unknown> }).items
      : {};
  const tempStates = Array.isArray(fixture.tempStates)
    ? fixture.tempStates
    : [];
  const queries = Array.isArray(fixture.queries) ? fixture.queries : [];
  console.log(
    `Fixture geladen: ${Object.keys(items).length} Komponenten, ${tempStates.length} TempStates, ${queries.length} Query(ies)`,
  );

  let appId: string | undefined;
  try {
    const loaded = await client.getApplication(TEMPLATE_NAME);
    appId = loaded.project.applicationId;
    console.log("Bestehendes Template gefunden:", appId);
  } catch {
    console.log("Template nicht gefunden, erstelle neu...");
    const created = await client.createProject(TEMPLATE_NAME);
    appId = created.applicationId;
    console.log("Template erstellt:", appId);
  }

  const loaded = await client.getApplication(appId);
  await client.saveApplication(loaded, fixture);
  console.log("Fixture gespeichert.");

  const verify = await client.getApplication(appId);
  const vItems =
    isRecord(verify.applicationDsl.ui) &&
    isRecord((verify.applicationDsl.ui as Record<string, unknown>).items)
      ? (verify.applicationDsl.ui as { items: Record<string, unknown> }).items
      : {};
  const vStates = Array.isArray(verify.applicationDsl.tempStates)
    ? verify.applicationDsl.tempStates.length
    : Object.keys(verify.applicationDsl.tempStates ?? {}).length;
  const vQueries = Array.isArray(verify.applicationDsl.queries)
    ? verify.applicationDsl.queries.length
    : Object.keys(verify.applicationDsl.queries ?? {}).length;

  console.log("Verifikation:");
  console.log(`  Komponenten: ${Object.keys(vItems).length}`);
  console.log(`  TempStates:  ${vStates}`);
  console.log(`  Queries:     ${vQueries}`);
  console.log("Template ready");
}

main().catch((e) => {
  console.error("FEHLER:", e);
  process.exit(1);
});
