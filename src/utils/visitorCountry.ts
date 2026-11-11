/**
 * Visitor's country (ISO-3166 alpha-2) from their IP address, used to
 * pre-select country + phone dial on the sign-up pages — a visitor in
 * Dubai sees UAE +971, not Georgia +995.
 *
 * Provider chain (first success wins; each gets its own timeout):
 *   1. Cloudflare trace  → `loc=AE`            (fast, CORS-enabled)
 *   2. ipwho.is          → { country_code }
 *   3. geojs.io          → { country }
 *   4. ip-api.com        → { countryCode }      (last resort: rate-limits
 *                                                shared/cloud IPs and
 *                                                often answers
 *                                                {"status":"fail"})
 * All four are free, keyless, CORS-enabled. Country-level only: we read
 * just the 2-letter ISO code and discard everything else. No tracking.
 *
 * Why the chain: on 2026-11-11 the live form still showed Georgia +995
 * for a visitor whose IP is AE, even though every provider above returns
 * AE when loaded directly in that same browser — the old 2.5s timeouts
 * were too tight for slow networks and ip-api alone fails from cloud
 * IPs, so one slow/failed leg used to sink the whole lookup. 6s per
 * provider now, and four legs, so a single failure can't do that.
 *
 * The answer is cached in sessionStorage so a reload doesn't re-fetch;
 * concurrent callers share one in-flight promise.
 */
const STORAGE_KEY = 'ebizearn_visitor_country_v1';
const ISO_RE = /^[A-Z]{2}$/;

function validIso(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const iso = raw.trim().toUpperCase();
  return ISO_RE.test(iso) ? iso : null;
}

function readStored(): string | null {
  try {
    return validIso(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function store(iso: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, iso);
  } catch {
    /* storage unavailable — fine */
  }
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    window.clearTimeout(timer);
  }
}

async function fromCloudflareTrace(timeoutMs: number): Promise<string | null> {
  const res = await fetchWithTimeout('https://www.cloudflare.com/cdn-cgi/trace', timeoutMs);
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('loc='));
  return validIso(line?.slice(4));
}

async function fromIpWho(timeoutMs: number): Promise<string | null> {
  const res = await fetchWithTimeout('https://ipwho.is/', timeoutMs);
  const data = (await res.json()) as { country_code?: unknown };
  return validIso(data.country_code);
}

async function fromGeoJs(timeoutMs: number): Promise<string | null> {
  const res = await fetchWithTimeout('https://get.geojs.io/v1/ip/country.json', timeoutMs);
  const data = (await res.json()) as { country?: unknown };
  return validIso(data.country);
}

async function fromIpApi(timeoutMs: number): Promise<string | null> {
  const res = await fetchWithTimeout('https://ip-api.com/json/?fields=status,countryCode', timeoutMs);
  const data = (await res.json()) as { status?: string; countryCode?: unknown };
  return data.status === 'success' ? validIso(data.countryCode) : null;
}

let inflight: Promise<string | null> | null = null;

export function detectVisitorCountry(timeoutMs = 6000): Promise<string | null> {
  const stored = readStored();
  if (stored) return Promise.resolve(stored);
  inflight ??= (async () => {
    const providers = [fromCloudflareTrace, fromIpWho, fromGeoJs, fromIpApi];
    for (const provider of providers) {
      try {
        const iso = await provider(timeoutMs);
        if (iso) return iso;
      } catch {
        /* try the next provider */
      }
    }
    return null;
  })().then((iso) => {
    if (iso) store(iso);
    return iso;
  });
  return inflight;
}
