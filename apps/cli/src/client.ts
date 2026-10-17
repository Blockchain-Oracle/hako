import type { Config } from "./config.js";
import { PAID_METHOD, PAID_NETWORK, REQUEST_TIMEOUT_MS, RUN_V2_PREFIX } from "./constants.js";

const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };

/** How a tool is paid for: its mainnet URL and the PayBox call that pays it (same fields as the plugin's hako_inspect). */
export interface PaidRun {
  paidUrl: string;
  howToPay: string;
}

/**
 * Hako over HTTP. discover / inspect / catalog are free. The CLI never signs or pays: inspect names the tool's paid
 * /v2 URL, and the user's PayBox wallet pays it (PayBox core use_service).
 */
export class Hako {
  constructor(private readonly config: Config) {}

  private async read(path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.config.apiUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: JSON_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const parsed = (await res.json()) as unknown;
    if (!res.ok) throw new Error(JSON.stringify(parsed));
    return parsed;
  }

  discover(query: string, limit: number): Promise<unknown> {
    return this.read("/v1/discover", { query, limit });
  }

  private paidRun(id: string): PaidRun {
    const paidUrl = `${this.config.apiUrl}${RUN_V2_PREFIX}/${id}`;
    return {
      paidUrl,
      howToPay:
        `Paid per call in USDC on Base (${PAID_NETWORK}) with your PayBox wallet: call PayBox's use_service ` +
        `with url ${paidUrl}, method ${PAID_METHOD} and the tool's input as body.`,
    };
  }

  async inspect(id: string): Promise<unknown> {
    const contract = (await this.read("/v1/inspect", { id })) as Record<string, unknown>;
    return { ...contract, ...this.paidRun(typeof contract.id === "string" ? contract.id : id) };
  }

  catalog(): Promise<unknown> {
    return this.read("/v1/catalog");
  }
}
