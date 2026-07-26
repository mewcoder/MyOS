/** Page fetching, in two tiers.
 *
 * HTTP covers far more than it looks: server-rendered pages (WeChat 公众号,
 * most blogs) obviously, but also X — which ships the post body in
 * `og:description` even though the visible DOM needs JavaScript.
 *
 * The browser tier exists for pages that genuinely render client-side. It is
 * launched per capture and closed afterwards: a resident browser in a
 * long-lived daemon is a memory and lifecycle liability for the handful of
 * links captured per day. Which tier to use is decided by whether extraction
 * actually produced content (see service.ts) rather than by guessing from the
 * URL or raw HTML size.
 */

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type FetchVia = "http" | "browser";

export interface FetchResult {
  html: string;
  finalUrl: string;
  via: FetchVia;
}

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }

  /** Whether a browser retry could plausibly succeed.
   *
   *  A missing or gone page stays missing — retrying just archives the site's
   *  404 page as if it were an article. Blocking and rate-limiting responses,
   *  on the other hand, are often aimed at plain HTTP clients specifically. */
  get worthRetryingInBrowser(): boolean {
    if (this.status === 401 || this.status === 403 || this.status === 429) return true;
    return this.status >= 500;
  }
}

export async function fetchViaHttp(url: string, timeoutMs = 30_000): Promise<FetchResult> {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) throw new HttpError(resp.status);

  return { html: await resp.text(), finalUrl: resp.url || url, via: "http" };
}

export async function fetchViaBrowser(url: string, timeoutMs = 30_000): Promise<FetchResult> {
  // Imported lazily so captures that never need a browser don't pay to load
  // playwright, and a missing Chrome only breaks this tier.
  const { chromium } = await import("playwright-core");

  const browser = await chromium.launch({
    channel: "chrome", // reuse the system Chrome — no bundled Chromium download
    headless: true,
  });

  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: "zh-CN",
      viewport: { width: 1280, height: 2000 },
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // Client-rendered content lands after the first paint; settle briefly
    // rather than waiting for networkidle, which ad/analytics traffic prevents.
    await page.waitForTimeout(2_500);
    return { html: await page.content(), finalUrl: page.url(), via: "browser" };
  } finally {
    await browser.close().catch(() => {});
  }
}
