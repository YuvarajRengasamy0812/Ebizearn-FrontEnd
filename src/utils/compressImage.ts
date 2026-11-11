/**
 * Shrink a proof screenshot in the browser before it is sent to the API.
 *
 * The live server rejects request bodies over ~1 MiB (Apache 413), and the
 * 413 carries no CORS headers, so the browser reports it as a network
 * error — "Can't reach the server" — instead of a size error. Phone
 * screenshots are routinely 1–5 MB, so they must be downscaled and
 * re-encoded here: the submit sends the image as base64 inside a JSON
 * body, which inflates it by another third.
 *
 * Target: a data URL well under 1 MiB, so the whole submit body stays
 * under the server limit with room for the proof URL and note.
 */

const MAX_EDGE = 1280;
const TARGET_CHARS = 700_000; // ~525 KB of image bytes as base64
const QUALITIES = [0.82, 0.7, 0.55];

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load image'));
    };
    img.src = url;
  });
}

/**
 * Returns a data URL for the screenshot, compressed when needed. Small
 * files pass through untouched. Throws only when the image cannot be
 * decoded at all — callers should fall back to the original file then.
 */
export async function compressScreenshot(file: File): Promise<string> {
  // Already tiny: sending it as-is keeps the body far under the limit.
  if (file.size <= 350 * 1024) {
    return readAsDataUrl(file);
  }

  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return readAsDataUrl(file);
  }
  ctx.drawImage(img, 0, 0, width, height);

  // JPEG: screenshots are photos of a screen, no transparency to preserve.
  let best = canvas.toDataURL('image/jpeg', QUALITIES[0]);
  for (const q of QUALITIES) {
    const candidate = canvas.toDataURL('image/jpeg', q);
    if (candidate.length <= TARGET_CHARS) {
      return candidate;
    }
    if (candidate.length < best.length) {
      best = candidate;
    }
  }
  return best;
}
