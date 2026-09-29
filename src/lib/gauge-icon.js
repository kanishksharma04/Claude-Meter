// Draws the toolbar icon as a ring gauge: a dark tile, a track, and an arc that
// sweeps clockwise from 12 o'clock as the session fills. At 32px and up the
// number sits in the middle; at 16px there is only room for the ring.
//
// drawGauge() takes any 2D context, so the service worker can use an
// OffscreenCanvas while the options page previews the same drawing in a <canvas>.

/** The sizes chrome.action.setIcon() wants: 1x and 2x toolbar pixels. */
export const GAUGE_SIZES = [16, 32];

const TILE = "#262624";
const TRACK = "rgba(245, 244, 239, 0.22)";
const TEXT = "#f5f4ef";
const DESIGN_SIZE = 32;

/**
 * @param {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} ctx
 * @param {number} size - width and height of the square being drawn, in pixels
 * @param {{ percent: number | null, color: string }} gauge - a null percent draws the
 *   "hidden" icon used by privacy mode: the empty ring and three dots, no reading
 */
export function drawGauge(ctx, size, { percent, color }) {
  const scale = size / DESIGN_SIZE;
  const concealed = percent == null;
  const pct = concealed ? 0 : Math.max(0, Math.min(100, percent));
  const withNumber = size >= DESIGN_SIZE;
  const center = size / 2;
  // Without the number the ring can be fatter, which is what keeps 16px legible.
  const lineWidth = (withNumber ? 3.4 : 5.5) * scale;
  const radius = (withNumber ? 12.3 : 10.6) * scale;

  ctx.clearRect(0, 0, size, size);

  ctx.fillStyle = TILE;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, 7 * scale);
  ctx.fill();

  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = TRACK;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.stroke();

  if (pct > 0) {
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(center, center, radius, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * pct) / 100);
    ctx.stroke();
  }

  if (concealed) {
    // Three dots where the number would be (one at 16px, where three won't fit).
    ctx.fillStyle = TEXT;
    for (const offset of withNumber ? [-5, 0, 5] : [0]) {
      ctx.beginPath();
      ctx.arc(center + offset * scale, center, (withNumber ? 1.6 : 2.6) * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (withNumber) {
    ctx.fillStyle = TEXT;
    ctx.font = `700 ${(pct >= 100 ? 10.5 : 13) * scale}px "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.round(pct)), center, center + 1 * scale);
  }
}

/** ImageData for each toolbar size, ready for chrome.action.setIcon({ imageData }). */
export function gaugeImageData(percent, color) {
  const images = {};
  for (const size of GAUGE_SIZES) {
    const ctx = new OffscreenCanvas(size, size).getContext("2d");
    drawGauge(ctx, size, { percent, color });
    images[size] = ctx.getImageData(0, 0, size, size);
  }
  return images;
}
