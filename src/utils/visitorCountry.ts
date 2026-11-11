/**
 * Visitor's country (ISO-3166 alpha-2) from their IP address, used to
 * pre-select country + phone dial on the sign-up pages — a visitor in
 * Dubai sees UAE +971, not Georgia +995.
 *
 * No key, no account: Cloudflare's trace endpoint first (it answers
 * `loc=AE`), ip-api.com as fallback. 2.5s per attempt; anything failing
 * returns null and the caller keeps its existing default. The answer is
 * cached in sessionStorage so a reload doesn't re-fetch.
 */
const STORAGE_KEY = 'ebizearn_visitor_country_v1';
const ISO_RE = /^[A-Z]{2}$/;

function validIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
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

async function fetchWithTimeout(url: string, ms: number): Promise<string> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    window.clearTimeout(timer);
  }
}

async function fromCloudflareTrace(): Promise<string | null> {
  const text = await fetchWithTimeout('https://www.cloudflare.com/cdn-cgi/trace', 2500);
  const line = text.split('\n').find((l) => l.startsWith('loc='));
  return validIso(line?.slice(4));
}

async function fromIpApi(): Promise<string | null> {
  const text = await fetchWithTimeout('https://ip-api.com/json/?fields=status,countryCode', 2500);
  try {
    const data = JSON.parse(text) as { status?: string; countryCode?: string };
    return data.status === 'success' ? validIso(data.countryCode) : null;
  } catch {
    return null;
  }
}

let inflight: Promise<string | null> | null = null;

export function detectVisitorCountry(): Promise<string | null> {
  const stored = readStored();
  if (stored) return Promise.resolve(stored);
  inflight ??= fromCloudflareTrace()
    .catch(() => null)
    .then((iso) => iso ?? fromIpApi().catch(() => null))
    .then((iso) => {
      if (iso) store(iso);
      return iso;
    });
  return inflight;
}
