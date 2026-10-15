# WebUI Guide

The Shinka WebUI is a local dashboard for evolution runs: it lists every run
under a directory, draws the genealogy of programs, and shows the code, diff,
evaluation output, and cost of any program. It reads the SQLite databases a
run writes, so it works on finished runs and on runs that are still in
progress.

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

The run list shows every `*.sqlite` or `*.db` file found below the root
directory (prompt databases are skipped). Click a run to open it.

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

### Run list

The landing page lists every run below the root directory, grouped by task
directory: status (active when a program was added in the last five minutes,
idle otherwise, empty for runs without programs), best score with its
generation, generations, programs with the number correct, cost, runtime, and
when the run was last updated. Click a row to open the run. Press `/` to
filter by name.

### Run page

One page per run, split into three parts:

- **Status strip** across the top: run name, active or idle, current
  generation, programs and the share that are correct, best score and the
  generation that found it, cost, runtime, and how long ago the last program
  arrived. The page polls every three seconds and reloads itself when a
  program is added.
- **Tree** on the left: one column per generation, the best lineage in orange,
  the best program ringed in gold, incorrect programs red, proposals that never
  reached evaluation as hollow dashed circles, and programs without a score in
  grey. At first only the best lineage, the newest lineage, and their siblings
  are shown; a `+N` pill shows the N programs hidden under a node and a `−` pill
  hides them again. Hover a node for its name, score, change from its parent,
  model, and patch type. Click a node to open it. **Fit** (`F`) shows the
  newest generations at a readable size; `W` fits the whole run however small.
  While you have not panned, the tree follows new generations as they arrive.
- **Right pane**: the selected program, or the run overview when nothing is
  selected or **Run overview** is pressed.
  - *Program*: name, generation, score with the change from its parent,
    model, patch type, cost, island, and a link to the parent. Code with
    syntax highlighting, or a diff from the parent with a changes-only mode.
    Below it, collapsible sections for the evaluation output (feedback,
    stdout, stderr, plot images), the LLM response, and the remaining
    metadata.
  - *Run overview*: stat cards, score by generation (best so far plus every
    correct program), cost per generation with the cumulative total, and the
    summarizer's scratchpad when the run wrote one.

Keys: arrows move between parent, child, and siblings; `B` selects the best
program; `F` fits; `W` shows the whole run; `Esc` returns to the overview.

The URL carries the run and the selected program, so a link opens exactly
what you were looking at. The theme button switches between light and dark;
the choice is remembered. Costs on the run list and the run page use the same
total: every program, every failed proposal, and prompt evolution.

### Advanced page

**Advanced** in the status strip opens the previous dashboard
(`viz_tree.html`) with all of its tabs: Pareto fronts, MAP grids, clusters,
embeddings, islands, ensembling, throughput, prompt evolution, the programs
table, and the comparison page. Nothing was removed; it is just not the
default any more.

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
| `/get_programs_summary` | `db_path`, optional `light=1` | All programs without code or raw embeddings, plus failed-proposal nodes. `light=1` also drops logs, LLM text, and code metrics (the run page uses this). |
| `/get_programs` | `db_path` | All programs including code and embeddings. Heavy. |
| `/get_program_count` | `db_path` | Program count and newest timestamp, used for change detection. |
| `/get_program_details` | `db_path`, `id` | One program with code. Failed proposals use ids of the form `failed:proposal:<generation>`. |
| `/get_database_stats` | `db_path` | Aggregates for the landing page. Missing databases return `{"error": "not_found"}`. |
| `/get_system_prompts` | `db_path` | Prompts from `prompts.sqlite` next to the database, or `[]`. |
| `/get_meta_files` | `db_path` | Available meta scratchpad files (`[]` when the run has none). |
| `/get_meta_content` | `db_path`, `processed_count` | Content of one meta file. |
| `/download_meta_pdf` | `db_path`, `processed_count` | The meta file as PDF (or text when no renderer is installed). |
| `/get_plots` | `db_path`, `generation`, `program_id` | Plot images saved by the evaluation of that generation. |
| `/plot_file/<path>` | | One plot image, path relative to the root directory. |

Errors are JSON objects with `error` and `status` fields.

---

## Layout of the code

```
shinka/webui/
  index.html, run.html                      run list and run page (the default UI)
  viz_tree.html, compare.html               the advanced dashboard
  static/css/                               one stylesheet per page; run/*.css per run-page module
  static/js/index.js, compare.js            page modules
  static/js/run/                            run page: main.js (state, URL), model.js (pure helpers),
                                            api.js, theme.js, status.js, tree.js, program.js, overview.js
  static/js/viz_tree/                       advanced dashboard, one ES module per tab or concern
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
`test_run_model.py` runs the run page's pure helpers under node, and
`test_browser.py` and `test_run_page.py` load every page in headless Chromium
(`playwright install chromium` once to enable it).
