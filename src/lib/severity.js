// One definition of "how full is too full": where a meter turns amber and red,
// and in which colours. Used by the toolbar icon, the popup bars and the
// options preview, and mirrored in src/content/page-ui.js for the in-page UI.

export const DEFAULT_CUTOFFS = { warnAt: 80, dangerAt: 95 };

/** What the toolbar icon uses when the user hasn't picked their own colours. */
export const DEFAULT_SEVERITY_COLORS = { ok: "#3fb950", warn: "#e5a02e", danger: "#e5484d" };

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isHexColor(value) {
  return typeof value === "string" && HEX_COLOR.test(value);
}

/**
 * Keeps both cut-offs in 1–100 with amber strictly below red. `changed` says
 * which one the user just edited, so the other is the one that gives way.
 */
export function normalizeCutoffs(warnAt, dangerAt, changed = "warnAt") {
  const clamp = (value, fallback) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : fallback;
  };
  let warn = clamp(warnAt, DEFAULT_CUTOFFS.warnAt);
  let danger = clamp(dangerAt, DEFAULT_CUTOFFS.dangerAt);

  if (warn >= danger) {
    if (changed === "dangerAt") {
      danger = Math.max(2, danger);
      warn = danger - 1;
    } else {
      warn = Math.min(99, warn);
      danger = warn + 1;
    }
  }
  return { warnAt: warn, dangerAt: danger };
}

/** @returns {"ok" | "warn" | "danger"} */
export function severityOf(pct, settings) {
  const { warnAt, dangerAt } = normalizeCutoffs(settings?.warnAt, settings?.dangerAt);
  if (pct >= dangerAt) return "danger";
  if (pct >= warnAt) return "warn";
  return "ok";
}

/** The user's colours where set (and valid), the defaults elsewhere. */
export function severityColors(settings, defaults = DEFAULT_SEVERITY_COLORS) {
  const custom = settings?.severityColors ?? {};
  return Object.fromEntries(
    Object.entries(defaults).map(([level, fallback]) => [level, isHexColor(custom[level]) ? custom[level] : fallback])
  );
}

export function severityColor(pct, settings) {
  return severityColors(settings)[severityOf(pct, settings)];
}
