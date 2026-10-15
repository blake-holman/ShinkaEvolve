# WebUI Guide

The Shinka WebUI is a local dashboard for evolution runs: it lists every run
under a directory, draws the genealogy of programs, and shows code, diffs,
evaluation logs, costs, and throughput for a selected run. It reads the SQLite
databases a run writes, so it works on finished runs and on runs that are
still in progress.

![WebUI Screenshot](media/webui.png)

---

## Quick Start

```bash
# Start evolution
shinka_launch

# In another terminal, serve the dashboard for the current directory
shinka_visualize --port 8888 --open

# Or point it at a results directory
shinka_visualize results_20241201_120000/ --port 8888 --open

# Or open one database directly (path relative to the root directory)
shinka_visualize results/ --db run_a/evolution_db.sqlite --open
```

The landing page lists every `*.sqlite` or `*.db` file found below the root
directory (prompt databases are skipped). Click a run to open the tree view.

### Remote machines

The server only accepts connections from the local machine by default.
Forward the port over SSH rather than exposing it:

```bash
# On the remote machine
shinka_visualize results/ --port 8888

# On your machine
ssh -L 8888:localhost:8888 user@remote-host
# then open http://localhost:8888
```

On a cluster, tunnel through the login node to the compute node:

```bash
ssh -L 8888:compute-node:8888 user@cluster-login-node
```

`--host 0.0.0.0` makes the server listen on every interface. Only do this on a
trusted network: the dashboard has no authentication and serves every
database and plot image under the root directory.

---

## Command line options

| Option | Default | Description |
|--------|---------|-------------|
| `root_directory` | `.` | Directory searched (recursively) for databases. Hidden directories, virtualenvs, and caches are skipped. |
| `-p, --port` | `8000` | Port to listen on. |
| `--host` | `127.0.0.1` | Interface to bind. `0.0.0.0` accepts remote connections. |
| `--db PATH` | none | Open this database directly; the path is relative to the root directory. |
| `--open` | off | Open the dashboard in a browser. |
| `--no-pdf` | off | Disable PDF export of the meta scratchpad (which shells out to `wkhtmltopdf` or `pandoc`). |
| `-v, --verbose` | off | Log every request. |

---

## Pages

### Landing page

One row per run, grouped by task directory, with program count, best score,
generation of the best score, generations since the last improvement, total
cost, runtime, and prompt-evolution cost when a `prompts.sqlite` exists.
Rows can be sorted by task or setting and filtered with the search box
(press `/` to focus it). Select two or more runs and press **Compare** to
open the compare page.

### Compare page

Score and cost curves for the selected runs on shared axes, using the
selection made on the landing page.

### Tree page

The left panel has one tab per view of the whole run:

| Tab | Content |
|-----|---------|
| Tree | Genealogy drawn with D3. Node colour is the score, shape is the patch type (init, diff, full, cross). The best program is highlighted; failed programs are red. Proposals that failed before evaluation appear as separate nodes. Click a node to load it into the right panel. |
| PromptEvo | Tree of evolved system prompts when the run used prompt evolution, with the programs each prompt produced. |
| Programs | Sortable, paginated table of programs with status, patch type, island, score, cost, complexity, and the attempt counters. |
| Metrics | Public metrics over generations. |
| Embed | Cosine-similarity heatmap of program embeddings, sortable chronologically, by cluster, or by score. |
| Clusters | PCA projection of embeddings in 2D and 3D. |
| Islands | Score and population curves per island, with migrations. |
| Ensembling | Posterior weight of each LLM over generations when model ensembling was on. |
| Path | The lineage from the initial program to the best program. |
| MAPs | A MAP-Elites style grid over two chosen metrics. |

The right panel describes the selected program:

| Tab | Content |
|-----|---------|
| Meta | Run overview: generations, correctness rate, best score, cost breakdown, score progression, and cumulative cost charts. |
| Pareto | Pareto front over two chosen metrics. |
| Scratch | The summarizer's meta scratchpad (`meta/meta_<count>.txt`) at each update, with a diff against the previous one and PDF export. |
| Node | Metadata of the selected program: parent, inspirations, island, timings, feedback. |
| Code | The program with syntax highlighting, copy, and download buttons. |
| Diff | Diff against the parent or against the initial program, with a changes-only mode. |
| Eval | Standard output and error of the evaluation, plus any plot images saved under `gen_<N>/results/plots/`. |
| LLM | The raw LLM response that produced the patch. |
| Analysis | Success and improvement rates by model and patch type, cost heatmaps, code size, and lineage fertility. |
| Usage | Runtime timeline per generation, worker occupancy, and stage duration summaries. |

The selected run, tabs, and node are kept in the URL, so a link can be
shared or bookmarked. Panel widths are kept in `localStorage`.

### Live runs

The clock button in the header toggles auto-refresh. While it is on, the page
polls a lightweight count endpoint every three seconds and reloads the data
only when a program was added. The reload button fetches everything
immediately.

---

## Troubleshooting

| Issue | What to do |
|-------|------------|
| Landing page is empty | Check the root directory: `shinka_visualize /path/to/results`. Databases in hidden directories are skipped. |
| "Database temporarily unavailable" | The run holds a write lock; the server retries for several seconds before giving up. Try again. |
| Port in use | `--port 9000` |
| Nothing loads through an SSH tunnel | Test with `curl http://localhost:8888/list_databases` on both ends. |
| Stale page after upgrading | Hard refresh (Ctrl+F5). HTML pages are served with `no-store` but a browser may cache module scripts briefly. |
| PDF export returns a text file | Neither `wkhtmltopdf` nor `pandoc` is installed. The meta file is served as text instead. |
| Need the old verbose console output | Open the page with `?debug=1` or set `localStorage.shinkaDebug = "1"` in the browser console. |

---

## HTTP API

All endpoints are `GET` and return JSON. `db_path` is relative to the root
directory; paths outside it are rejected with 403.

| Endpoint | Parameters | Returns |
|----------|------------|---------|
| `/list_databases` | | Every database below the root with its task and display name. |
| `/get_programs_summary` | `db_path` | All programs without code or raw embeddings, plus failed-proposal nodes. |
| `/get_programs` | `db_path` | All programs including code and embeddings. Heavy. |
| `/get_program_count` | `db_path` | Program count and newest timestamp, used for change detection. |
| `/get_program_details` | `db_path`, `id` | One program with code. Failed proposals use ids of the form `failed:proposal:<generation>`. |
| `/get_database_stats` | `db_path` | Aggregates for the landing page. Missing databases return `{"error": "not_found"}`. |
| `/get_system_prompts` | `db_path` | Prompts from `prompts.sqlite` next to the database, or `[]`. |
| `/get_meta_files` | `db_path` | Available meta scratchpad files. |
| `/get_meta_content` | `db_path`, `processed_count` | Content of one meta file. |
| `/download_meta_pdf` | `db_path`, `processed_count` | The meta file as PDF (or text when no renderer is installed). |
| `/get_plots` | `db_path`, `generation`, `program_id` | Plot images saved by the evaluation of that generation. |
| `/plot_file/<path>` | | One plot image, path relative to the root directory. |

Errors are JSON objects with `error` and `status` fields.

---

## Layout of the code

```
shinka/webui/
  index.html, viz_tree.html, compare.html   HTML shells
  static/css/                               one stylesheet per page
  static/js/index.js, compare.js            page modules
  static/js/viz_tree/                       one ES module per tab or concern; main.js is the entry point
  static/js/log.js                          debug logger (silent unless enabled)
  static/vendor/                            pinned third-party libraries (see README.md there)
  server/                                   HTTP server package
    cli.py                                  shinka_visualize entry point
    app.py                                  threaded server, routing, static files
    endpoints/                              one module per API resource
    db_reader.py                            read-only SQLite access, retries, cache
    failed_nodes.py                         synthetic nodes for failed proposals
    pdf_export.py                           meta scratchpad to PDF
```

The pages are plain ES modules with no build step. Tests live in
`tests/webui/`: endpoint tests run against a synthetic results directory,
and `test_browser.py` loads every page and tab in headless Chromium
(`playwright install chromium` once to enable it).
