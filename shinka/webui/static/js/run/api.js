// HTTP client for the dashboard API. Every function returns parsed JSON and
// throws an Error with a readable message on failure.

const detailCache = new Map();

async function getJson(path, params = {}) {
    const url = new URL(path, window.location.origin);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
    const response = await fetch(url);
    if (!response.ok) {
        let message = `${response.status} ${response.statusText}`;
        try {
            const body = await response.json();
            if (body && body.error) message = body.error;
        } catch (_) { /* not JSON */ }
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }
    return response.json();
}

export const api = {
    listDatabases: () => getJson("/list_databases"),

    /** Every program without code (plus failed proposal nodes). */
    programsSummary: (dbPath) => getJson("/get_programs_summary", { db_path: dbPath }),

    /** Program count and newest timestamp, for change detection. */
    programCount: (dbPath) => getJson("/get_program_count", { db_path: dbPath }),

    /** One program with code. Cached per (dbPath, id); call forget() after a refresh. */
    async programDetails(dbPath, id) {
        const key = `${dbPath}\u0000${id}`;
        if (!detailCache.has(key)) {
            detailCache.set(key, getJson("/get_program_details", { db_path: dbPath, id }).catch((error) => {
                detailCache.delete(key);
                throw error;
            }));
        }
        return detailCache.get(key);
    },

    forgetDetails() { detailCache.clear(); },

    stats: (dbPath) => getJson("/get_database_stats", { db_path: dbPath }),
    metaFiles: (dbPath) => getJson("/get_meta_files", { db_path: dbPath }).catch((e) => (e.status === 404 ? [] : Promise.reject(e))),
    metaContent: (dbPath, processedCount) => getJson("/get_meta_content", { db_path: dbPath, processed_count: processedCount }),
    plots: (dbPath, generation, programId) => getJson("/get_plots", { db_path: dbPath, generation, program_id: programId }),
    plotUrl: (path) => `/plot_file/${path.split("/").map(encodeURIComponent).join("/")}`,
};
