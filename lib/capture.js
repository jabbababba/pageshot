import { planBands } from "./plan.js";

export const JPEG_QUALITY = 90;
export const CAPTURE_SCALE = 1;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getMetrics(send) {
  const { cssContentSize, cssLayoutViewport } = await send("Page.getLayoutMetrics");
  return {
    width: Math.ceil(cssContentSize.width),
    height: Math.ceil(cssContentSize.height),
    viewportHeight: Math.ceil(cssLayoutViewport.clientHeight),
  };
}

// Walk the page once so that content which loads on scroll actually exists
// before we photograph it. Without this, lazy images come out as blank space.
export async function primeLazyContent(send, { height, viewportHeight }, sleep = defaultSleep) {
  const step = Math.max(200, viewportHeight);
  for (let y = 0; y < height; y += step) {
    await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${y})` });
    await sleep(120);
  }
  await send("Runtime.evaluate", { expression: "window.scrollTo(0, 0)" });
  await sleep(200);
}

// One band is one output file, so there is no stitching anywhere in this
// extension. Clip coordinates are page-absolute because captureBeyondViewport
// is true, which also means the page is never scrolled while shooting, so
// sticky headers cannot repeat down the image.
export async function captureBands(send, {
  width, bands, quality = JPEG_QUALITY, scale = CAPTURE_SCALE, onProgress = () => {},
}) {
  const urls = [];
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    onProgress(i + 1, bands.length);
    const { data } = await send("Page.captureScreenshot", {
      format: "jpeg",
      quality,
      captureBeyondViewport: true,
      clip: { x: 0, y: band.y, width, height: band.height, scale },
    });
    urls.push(`data:image/jpeg;base64,${data}`);
  }
  return urls;
}

export async function captureJpegs(send, { onProgress = () => {}, sleep = defaultSleep } = {}) {
  const { width, height, viewportHeight } = await getMetrics(send);
  await primeLazyContent(send, { height, viewportHeight }, sleep);

  // Re-measure: priming often grows the page as deferred content arrives.
  const after = await getMetrics(send);
  const bands = planBands(after.height);
  return captureBands(send, { width: after.width, bands, onProgress });
}
