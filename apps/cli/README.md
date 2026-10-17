# Hako CLI and MCP server

Find and inspect Hako's agent tools from a terminal or an MCP client. Discovery and inspection are free and need no account. A run is paid per call in USDC on Base with your own PayBox wallet; the CLI holds no key and pays nothing itself. Node.js 20 or later is required.

## Run it

```sh
npx -y usehako --version
```

Or install it globally: `npm install -g usehako`, then use the `hako` command.

## CLI

```sh
npx -y usehako discover "weather in Lagos"
npx -y usehako inspect openweather/current
npx -y usehako catalog
```

`inspect` prints the tool's contract plus `paidUrl` (its `/v2/run/<provider>/<slug>` URL on `https://api.usehako.site`) and `howToPay`. To run the tool, have your PayBox agent call PayBox's `use_service` with that URL, method `POST` and the tool's input as the body; PayBox pays the exact price in USDC on Base from your wallet and returns the answer. `HAKO_API_URL` points the CLI at another gateway.

## MCP

`hako mcp` starts a local MCP server over stdio with `hako_discover` and `hako_inspect`, both free. Configure your MCP client to launch `npx -y usehako mcp`. For a client that accepts a remote MCP URL, connect to `https://api.usehako.site/mcp` instead; it serves the same two tools.

See the [CLI guide](https://docs.usehako.site/docs/cli) and [MCP setup](https://docs.usehako.site/docs/quickstart/mcp). Source: [Blockchain-Oracle/hako](https://github.com/Blockchain-Oracle/hako).
