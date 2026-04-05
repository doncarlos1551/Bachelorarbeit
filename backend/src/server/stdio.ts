import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBaselineMcpServer } from "src/server/mcp-server";
import { BaselineService } from "src/app/service";

const main = async (): Promise<void> => {
  const service = new BaselineService();
  const server = createBaselineMcpServer(service);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error("[mcp-baseline] stdio transport ready");

  const close = async (signal: string) => {
    console.error(`[mcp-baseline] received ${signal}, shutting down`);
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void close("SIGINT");
  });
  process.on("SIGTERM", () => {
    void close("SIGTERM");
  });
};

main().catch((error) => {
  console.error("[mcp-baseline] fatal", error);
  process.exit(1);
});
