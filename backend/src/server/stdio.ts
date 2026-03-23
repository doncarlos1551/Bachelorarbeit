import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

async function main() {
  const server = new McpServer(
    { name: "mcp-baseline", version: "0.0.1" },
    {
      capabilities: { logging: {} },
      instructions: "MSL Sandbox Layer (Skelett)",
    },
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("[mcp-baseline] stdio fatal:", error);
  process.exit(1);
});
