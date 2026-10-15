// Light and dark theme. The choice is stored in localStorage and applied as
// data-theme on <html>; charts read the resolved colours from CSS variables.

const STORAGE_KEY = "shinkaTheme";
const listeners = new Set();

export function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || "light";
}

export function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (_) { /* private mode */ }
    for (const listener of listeners) listener(theme);
}

export function initTheme() {
    let theme = null;
    try { theme = localStorage.getItem(STORAGE_KEY); } catch (_) { /* private mode */ }
    if (theme !== "light" && theme !== "dark") {
        theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", theme);
    return theme;
}

export function toggleTheme() {
    applyTheme(currentTheme() === "dark" ? "light" : "dark");
}

export function onThemeChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Resolved CSS variables for use in SVG and Plotly, re-read on every call. */
export function themeColors() {
    const style = getComputedStyle(document.documentElement);
    const read = (name) => style.getPropertyValue(name).trim();
    return {
        bg: read("--bg"), bgElev: read("--bg-elev"), bgSunken: read("--bg-sunken"),
        fg: read("--fg"), fgMuted: read("--fg-muted"), fgFaint: read("--fg-faint"),
        border: read("--border"), borderStrong: read("--border-strong"),
        accent: read("--accent"), ok: read("--ok"), bad: read("--bad"), warn: read("--warn"),
        best: read("--best"), lineage: read("--lineage"), select: read("--select"),
        font: read("--font"), mono: read("--mono"),
    };
}

/** Plotly layout defaults matching the theme. Spread into every chart layout. */
export function plotlyLayout(overrides = {}) {
    const c = themeColors();
    return {
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        font: { family: c.font, size: 12, color: c.fg },
        margin: { l: 48, r: 16, t: 8, b: 40 },
        xaxis: { gridcolor: c.border, zerolinecolor: c.border, linecolor: c.border, tickfont: { color: c.fgMuted } },
        yaxis: { gridcolor: c.border, zerolinecolor: c.border, linecolor: c.border, tickfont: { color: c.fgMuted } },
        legend: { orientation: "h", y: 1.12, x: 0, font: { color: c.fgMuted } },
        hoverlabel: { bgcolor: c.bgElev, bordercolor: c.borderStrong, font: { color: c.fg, family: c.font } },
        ...overrides,
    };
}

export const PLOTLY_CONFIG = { displayModeBar: false, responsive: true };
