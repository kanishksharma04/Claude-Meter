// Fetches the Anthropic Console cost report with the user's Admin API key.
// The key goes to api.anthropic.com and nowhere else, in the header the
// Admin API asks for. See lib/api-spend.js for what the report is.

import { costReportRequest, parseCostReport, spendProblem } from "./api-spend.js";

/** The report comes a page of buckets at a time; a month is one page, so this is only a guard. */
const MAX_PAGES = 4;

export class ConsoleApiError extends Error {
  constructor(status) {
    const problem = spendProblem(status);
    super(problem.text);
    this.name = "ConsoleApiError";
    this.status = status;
    this.problem = problem;
  }
}

/**
 * @param {string} adminKey - an Admin API key (sk-ant-admin…)
 * @returns {Promise<Array<{ day: number, total: number, lines: Record<string, number> }>>} the last month, by day
 */
export async function fetchSpend(adminKey, now = Date.now()) {
  const buckets = [];
  let page = null;
  for (let count = 0; count < MAX_PAGES; count++) {
    let response;
    try {
      response = await fetch(costReportRequest(now, page), {
        headers: { "x-api-key": adminKey, "anthropic-version": "2023-06-01" },
        // No cookies: this is the key's request, not the signed-in browser's.
        credentials: "omit",
      });
    } catch {
      throw new ConsoleApiError(0);
    }
    if (!response.ok) throw new ConsoleApiError(response.status);

    const body = await response.json().catch(() => null);
    buckets.push(...(Array.isArray(body?.data) ? body.data : []));
    if (!body?.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return parseCostReport(buckets);
}
