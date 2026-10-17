import { Hako } from "./client.js";
import { readConfig } from "./config.js";
import { DEFAULT_DISCOVER_LIMIT, VERSION } from "./constants.js";
import { serveMcp } from "./mcp.js";

const HELP = `hako ${VERSION} — Hako's agent tools from a terminal: find and read them free, pay runs with your PayBox wallet

  hako discover "<what you need>" [--limit N]   rank tools for a job (free)
  hako inspect <provider/endpoint>              a tool's input schema, price, example and paid URL (free)
  hako catalog                                  every tool as JSON (free)
  hako mcp                                      local MCP server over stdio: hako_discover, hako_inspect (free)

Without installing: npx -y usehako <command>.
Paid runs: inspect prints the tool's paidUrl. Your PayBox wallet pays it in USDC on Base with PayBox's use_service.
Environment: HAKO_API_URL (default https://api.usehako.site).`;

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/** Positional words: everything that is neither a --flag nor a flag's value. */
function words(args: string[]): string[] {
  return args.filter((arg, i) => !arg.startsWith("--") && !(i > 0 && args[i - 1]?.startsWith("--")));
}

const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const hako = new Hako(readConfig());
  switch (command) {
    case "discover": {
      const query = words(rest).join(" ");
      if (!query) throw new Error('usage: hako discover "<what you need>"');
      print(await hako.discover(query, Number(flag(rest, "--limit") ?? DEFAULT_DISCOVER_LIMIT)));
      return;
    }
    case "inspect":
      if (!rest[0]) throw new Error("usage: hako inspect <provider/endpoint>");
      print(await hako.inspect(rest[0]));
      return;
    case "catalog":
      print(await hako.catalog());
      return;
    case "mcp":
      await serveMcp(hako);
      return;
    case "--version":
    case "version":
      process.stdout.write(`${VERSION}\n`);
      return;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(`${HELP}\n`);
      return;
    default: // a typo must not look like success to a script
      process.stderr.write(`hako: unknown command '${command}'\n\n${HELP}\n`);
      process.exitCode = 1;
  }
}

// Node's fetch reports every network failure as "fetch failed"; the reason (reset, timeout, DNS) is in `cause`.
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause ? `${error.message} (${describe(error.cause)})` : error.message;
}

main().catch((error: unknown) => {
  process.stderr.write(`hako: ${describe(error)}\n`);
  process.exit(1);
});
