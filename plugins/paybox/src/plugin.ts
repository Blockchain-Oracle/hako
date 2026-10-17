import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { PLUGIN_NAME, PLUGIN_VERSION, PROTOCOL_VERSION } from "./constants.js";
import { registerCatalogTools } from "./tools/catalog.js";

function createServer() {
  const server = new McpServer(
    { name: PLUGIN_NAME, version: PLUGIN_VERSION },
    { supportedProtocolVersions: [PROTOCOL_VERSION] },
  );
  registerCatalogTools(server);
  return server;
}

serveStdio(createServer, { legacy: "reject" });
