import { DEFAULT_API_URL } from "./constants.js";

export interface Config {
  apiUrl: string;
}

/** Environment only. The CLI holds no key: paid runs are paid by the user's own PayBox wallet. */
export function readConfig(): Config {
  return { apiUrl: (process.env.HAKO_API_URL?.trim() || DEFAULT_API_URL).replace(/\/$/, "") };
}
