// Chart annotations: short notes the user pins to a moment in time — "started
// project X", "switched to Sonnet" — shown as numbered markers on the
// usage-over-time chart, so a change in the lines can be traced to its cause.
//
//   Annotation = { id: string, at: number, text: string }   // `at` is epoch ms

export const MAX_ANNOTATIONS = 100;
export const MAX_NOTE_LENGTH = 80;

/** Tidies what was typed: single-spaced, trimmed, capped. Empty means "not a note". */
export function cleanNote(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_LENGTH);
}

/**
 * Adds a note, keeping the list in time order. Returns the same array when the
 * text is empty or the time isn't a real one. When full, the oldest note goes.
 */
export function addAnnotation(list, { at, text }, id = `${at}-${Math.random().toString(36).slice(2, 8)}`) {
  const notes = list ?? [];
  const clean = cleanNote(text);
  if (!clean || !Number.isFinite(at)) return notes;
  return [...notes, { id, at, text: clean }].sort((a, b) => a.at - b.at).slice(-MAX_ANNOTATIONS);
}

export function removeAnnotation(list, id) {
  return (list ?? []).filter((note) => note.id !== id);
}

/**
 * The notes that fall on a chart spanning [from, to], oldest first, each with
 * its marker number and its position along the axis as a 0–1 fraction.
 */
export function placeAnnotations(list, { from, to }) {
  const span = Math.max(1, to - from);
  return (list ?? [])
    .filter((note) => note.at >= from && note.at <= to)
    .map((note, index) => ({ ...note, number: index + 1, x: (note.at - from) / span }));
}

/** A datetime-local field's value ("2026-09-30T14:05") as epoch ms; empty means now. */
export function parseWhen(value, now = Date.now()) {
  if (!value) return now;
  const parsed = new Date(value).getTime();
  // A note can't be pinned to the future — there is nothing on the chart there.
  return Number.isFinite(parsed) ? Math.min(parsed, now) : now;
}
