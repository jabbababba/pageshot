// Chrome refuses to produce a single screenshot taller than this. It is a GPU
// texture limit, not a setting, so tall pages must be captured band by band.
export const MAX_BAND = 16384;

// Slice a page height into top-to-bottom capture bands. Bands never overlap
// and together cover the whole page.
export function planBands(contentHeight, maxBand = MAX_BAND) {
  const total = Math.floor(contentHeight);
  if (!Number.isFinite(total) || total <= 0) return [];

  const bands = [];
  for (let y = 0; y < total; y += maxBand) {
    bands.push({ y, height: Math.min(maxBand, total - y) });
  }
  return bands;
}
