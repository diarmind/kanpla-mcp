import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadConfig } from "./config.js";
import { KanplaClient } from "./kanpla.js";
import { todayIso } from "./menu.js";

/**
 * Lazily build the Kanpla client on first use, so the server can start and
 * advertise its tools even before credentials are checked. Config/credential
 * errors then surface as tool errors instead of crashing the process.
 */
let client: KanplaClient | null = null;
function getClient(): KanplaClient {
  if (!client) {
    client = new KanplaClient(loadConfig());
  }
  return client;
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
}

const server = new McpServer({
  name: "kanpla-mcp",
  version: "0.1.0",
});

server.registerTool(
  "get_today_menu",
  {
    title: "Get today's menu",
    description: "Returns the available Kanpla menu items for today.",
    inputSchema: {
      moduleId: z
        .string()
        .optional()
        .describe("Canteen/module id. Overrides KANPLA_MODULE_ID for this call."),
    },
  },
  async ({ moduleId }) => {
    try {
      return ok(await getClient().getMenu(todayIso(), moduleId));
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  "get_menu_for_date",
  {
    title: "Get menu for a date",
    description: "Returns the available Kanpla menu items for a specific date.",
    inputSchema: {
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be an ISO date, YYYY-MM-DD.")
        .describe("ISO date, YYYY-MM-DD."),
      moduleId: z
        .string()
        .optional()
        .describe("Canteen/module id. Overrides KANPLA_MODULE_ID for this call."),
    },
  },
  async ({ date, moduleId }) => {
    try {
      return ok(await getClient().getMenu(date, moduleId));
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  "list_modules",
  {
    title: "List modules",
    description:
      "Lists the canteens/modules available to your account, so you can find your moduleId.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await getClient().listModules());
    } catch (error) {
      return fail(error);
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for the MCP protocol; log to stderr only.
  console.error("kanpla-mcp server running on stdio.");
}

main().catch((error) => {
  console.error("Fatal error starting kanpla-mcp:", error);
  process.exit(1);
});
