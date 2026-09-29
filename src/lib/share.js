// A usage summary to paste somewhere else — as plain text, or drawn as a PNG
// card. Both show what the popup shows: the buckets the user hasn't hidden, in
// their order. Nothing about individual chats is ever included.

import { arrangeBuckets } from "./bucket-prefs.js";
import { formatDuration } from "./time-format.js";

/** Card geometry, in CSS pixels; drawShareCard() scales it up for sharpness. */
const CARD = { width: 560, padding: 28, header: 40, row: 64, footer: 26, bar: 8, radius: 18 };
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

/** The rows a summary contains: pinned buckets, then the rest; hidden ones left out. */
export function shareRows(snapshot, bucketPrefs, now = Date.now()) {
  const { pinned, rest } = arrangeBuckets(snapshot, bucketPrefs);
  return [...pinned, ...rest].map(({ kind, bucket }) => ({
    name: kind === "weekly" ? `${bucket.label} (weekly)` : bucket.label,
    percentUsed: bucket.percentUsed,
    resetsIn: formatDuration(now, bucket.resetsAt),
  }));
}

function formatWhen(now) {
  return new Date(now).toLocaleString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** One line per limit under a dated heading — readable in a chat message or an issue. */
export function buildShareText(snapshot, { bucketPrefs, now = Date.now() } = {}) {
  const rows = shareRows(snapshot, bucketPrefs, now);
  const lines = rows.map(
    (row) => `${row.name}: ${row.percentUsed}% used` + (row.resetsIn ? ` · resets in ${row.resetsIn}` : "")
  );
  return [`ClaudeMeter — ${formatWhen(now)}`, ...(lines.length ? lines : ["No usage reading yet."])].join("\n");
}

/** The canvas size (in CSS pixels) a card with this many rows needs. */
export function shareCardSize(rowCount) {
  return {
    width: CARD.width,
    height: CARD.padding * 2 + CARD.header + Math.max(1, rowCount) * CARD.row + CARD.footer,
  };
}

/**
 * Draws the card. The canvas must already be sized to shareCardSize() × scale.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{
 *   rows: ReturnType<typeof shareRows>,
 *   palette: { bg: string, border: string, text: string, muted: string, track: string },
 *   fillFor: (percentUsed: number) => string,
 *   now?: number,
 *   scale?: number,
 * }} card - `fillFor` picks each bar's colour, so the card follows the user's theme and warning levels
 */
export function drawShareCard(ctx, { rows, palette, fillFor, now = Date.now(), scale = 2 }) {
  const { width, height } = shareCardSize(rows.length);
  const left = CARD.padding;
  const right = width - CARD.padding;

  ctx.save();
  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = palette.bg;
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, width - 1, height - 1, CARD.radius);
  ctx.fill();
  ctx.stroke();

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = palette.text;
  ctx.font = `600 20px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("ClaudeMeter", left, CARD.padding + 20);

  ctx.fillStyle = palette.muted;
  ctx.font = `13px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(formatWhen(now), right, CARD.padding + 19);

  let y = CARD.padding + CARD.header;
  if (rows.length === 0) {
    ctx.textAlign = "left";
    ctx.fillText("No usage reading yet.", left, y + 22);
  }

  for (const row of rows) {
    ctx.fillStyle = palette.text;
    ctx.font = `600 15px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(row.name, left, y + 16);

    ctx.fillStyle = palette.muted;
    ctx.font = `14px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(`${row.percentUsed}% used`, right, y + 16);

    const barY = y + 26;
    const barWidth = right - left;
    ctx.fillStyle = palette.track;
    ctx.beginPath();
    ctx.roundRect(left, barY, barWidth, CARD.bar, CARD.bar / 2);
    ctx.fill();

    const filled = (barWidth * Math.max(0, Math.min(100, row.percentUsed))) / 100;
    if (filled > 0) {
      ctx.fillStyle = fillFor(row.percentUsed);
      ctx.beginPath();
      ctx.roundRect(left, barY, Math.max(CARD.bar, filled), CARD.bar, CARD.bar / 2);
      ctx.fill();
    }

    if (row.resetsIn) {
      ctx.fillStyle = palette.muted;
      ctx.font = `12px ${FONT}`;
      ctx.textAlign = "left";
      ctx.fillText(`Resets in ${row.resetsIn}`, left, barY + CARD.bar + 17);
    }
    y += CARD.row;
  }

  ctx.fillStyle = palette.muted;
  ctx.font = `11px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("claude.ai plan usage", left, height - CARD.padding + 8);
  ctx.restore();
}
