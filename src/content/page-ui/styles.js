// The in-page UI's stylesheet, adopted into its shadow root by dock.js. See core.js for how these files fit together.

// ------------------------------------------------------------------ styles --

const STYLES = `
  :host { all: initial; }

  .dock {
    position: fixed;
    z-index: 2147483000;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    pointer-events: none;
    font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, sans-serif;
    color: var(--text);
  }
  .dock > * { pointer-events: auto; }
  .dock [hidden] { display: none !important; }

  .dock[data-theme="dark"] {
    color-scheme: dark;
    --bg: #262624; --panel: #30302e; --border: #3e3e3a; --text: #f5f4ef; --muted: #a8a6a0;
    --accent: #cc785c; --track: #3e3e3a; --ok: #7a9b6e; --warn: #d9a452; --danger: #c1554a;
  }
  .dock[data-theme="light"] {
    color-scheme: light;
    --bg: #faf9f5; --panel: #f0eee6; --border: #e5e2d9; --text: #30302e; --muted: #82807a;
    --accent: #cc785c; --track: #e5e2d9; --ok: #4f9358; --warn: #b87f2e; --danger: #b54b3f;
  }
  .dock[data-theme="contrast"] {
    color-scheme: dark;
    --bg: #000000; --panel: #0f0f0f; --border: #b3b3b3; --text: #ffffff; --muted: #dcdcdc;
    --accent: #66d9ff; --track: #2b2b2b; --ok: #5dff8f; --warn: #ffb000; --danger: #ff8080;
  }
  .dock[data-theme="contrast"] .track { outline: 1px solid var(--border); }

  * { box-sizing: border-box; }

  .pill-row { display: flex; align-items: center; gap: 6px; }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.18);
  }
  .pill:hover { background: var(--panel); }
  :is(button, a):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .pill .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
  .pill.warn .dot { background: var(--warn); }
  .pill.danger .dot { background: var(--danger); }
  .pill .sep, .pill .stale { color: var(--muted); }

  .chip {
    padding: 3px 9px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--panel);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .chip strong { color: var(--text); font-weight: 600; }

  /* Privacy mode (screen sharing): figures blurred past reading; bars lose the
     width and colour that would give them away. */
  .dock[data-privacy="on"] :is(.bucket-pct, .panel .sub, .banner-text, .lockout-main, .lockout-count, .chip.locked) {
    filter: blur(5px);
    user-select: none;
  }
  .dock[data-privacy="on"] .fill {
    width: 100% !important;
    background: repeating-linear-gradient(-45deg, var(--track), var(--track) 4px, var(--border) 4px, var(--border) 8px);
  }
  .dock[data-privacy="on"] .pill .dot { background: var(--muted); }

  .panel {
    width: 264px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.28);
  }
  .panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .panel-title { font-weight: 600; font-size: 13px; }
  .icon-btn {
    border: none; background: none; color: var(--muted); font: inherit; font-size: 14px;
    cursor: pointer; padding: 2px 6px; border-radius: 6px;
  }
  .icon-btn:hover { color: var(--text); background: var(--panel); }
  .bucket { margin-bottom: 10px; }
  .bucket-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
  .bucket-label { font-weight: 600; }
  .bucket-pct { color: var(--muted); font-variant-numeric: tabular-nums; }
  .track { height: 6px; border-radius: 999px; background: var(--track); overflow: hidden; }
  .fill { height: 100%; border-radius: 999px; background: var(--ok-fill, var(--accent)); }
  .fill.warn { background: var(--warn); }
  .fill.danger { background: var(--danger); }
  .sub { margin-top: 4px; color: var(--muted); font-size: 11px; }
  .panel-foot { color: var(--muted); font-size: 11px; }

  .lockout {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    padding: 10px 10px 10px 14px;
    border: 1px solid var(--danger);
    border-left-width: 3px;
    border-radius: 12px;
    background: var(--bg);
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.28);
  }
  .lockout-main { flex: 1; min-width: 0; }
  .lockout-title { font-weight: 600; font-size: 13px; }
  .lockout-sub { color: var(--muted); font-size: 11px; margin-top: 2px; }
  .lockout-count {
    font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.01em;
  }
  .chip.locked { border-color: var(--danger); color: var(--text); cursor: pointer; font: inherit; }

  .banners { display: flex; flex-direction: column; gap: 6px; width: 100%; }
  .banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px 7px 12px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 10px;
    background: var(--bg);
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.18);
  }
  .banner.warn { border-left-color: var(--warn); }
  .banner.danger { border-left-color: var(--danger); }
  .banner-text { flex: 1; min-width: 0; }
  .banner-text strong { font-weight: 600; }
  .banner-action {
    color: var(--accent); font: inherit; font-weight: 600; text-decoration: none;
    border: none; background: none; padding: 0; cursor: pointer; white-space: nowrap;
  }
  .banner-action:hover { text-decoration: underline; }
`;
