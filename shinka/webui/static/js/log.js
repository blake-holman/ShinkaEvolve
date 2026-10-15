// Debug logging for the dashboard pages.
//
// The pages used to print several hundred console.log lines per session.
// Those messages now go through debug(), which is silent unless the page is
// opened with ?debug=1 or localStorage.shinkaDebug is set to "1".
// Warnings and errors still use console.warn and console.error directly.

const enabled =
    new URLSearchParams(window.location.search).has("debug") ||
    window.localStorage.getItem("shinkaDebug") === "1";

export function debug(...args) {
    if (enabled) {
        console.log(...args);
    }
}

export function isDebugEnabled() {
    return enabled;
}
