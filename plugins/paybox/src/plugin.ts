import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import {
  PLUGIN_DESCRIPTION,
  PLUGIN_ICON,
  PLUGIN_NAME,
  PLUGIN_TITLE,
  PLUGIN_VERSION,
  PLUGIN_WEBSITE_URL,
  PROTOCOL_VERSION,
  SERVER_INSTRUCTIONS,
} from "./constants.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerEarnTools } from "./tools/earn.js";
import { registerInvoiceTools } from "./tools/invoice.js";
import { registerMoneyTools } from "./tools/money.js";
import { registerReadTools } from "./tools/reads.js";

/** Hako's server identity and frozen tool surface (plan §1 A); every tool calls the gateway only when it runs. */
function createServer() {
  const server = new McpServer(
    {
      name: PLUGIN_NAME,
      title: PLUGIN_TITLE,
      version: PLUGIN_VERSION,
      description: PLUGIN_DESCRIPTION,
      websiteUrl: PLUGIN_WEBSITE_URL,
      icons: [PLUGIN_ICON],
    },
    { supportedProtocolVersions: [PROTOCOL_VERSION], instructions: SERVER_INSTRUCTIONS },
  );
  registerCatalogTools(server);
  registerMoneyTools(server);
  registerEarnTools(server);
  registerReadTools(server);
  registerInvoiceTools(server);
  return server;
}

serveStdio(createServer, { legacy: "reject" });
