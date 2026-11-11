/**
 * Lightweight client-side country detection from the visitor's IP, used
 * only to pre-select the phone field's country-code picker (dial code +
 * flag together, matched by ISO code — never by rendered label text, so
 * it works under any page translation).
 *
 * Delegates to the single shared chain in visitorCountry.ts (Cloudflare
 * trace → ipwho.is → geojs.io → ip-api.com, first success wins) so the
 * phone field and the sign-up pages never run two different lookups or
 * race each other. Country-level only: we read just the 2-letter ISO
 * code and discard everything else. No tracking.
 *
 * Non-blocking: resolves asynchronously; callers must render with a
 * default first and update only if/when this resolves.
 * Silent failure: returns `null` on timeouts, HTTP errors, or malformed
 * payloads — callers fall back to the default dial code (+995 Georgia).
 */
import { detectVisitorCountry } from './visitorCountry';

export async function detectCountryIso(timeoutMs = 6000): Promise<string | null> {
  return detectVisitorCountry(timeoutMs);
}
