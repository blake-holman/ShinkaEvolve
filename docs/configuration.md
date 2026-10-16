# Configuration Guide

This document is synced to the current code + config files in this repo.

---

## Default Layers (Source of Truth)

Configuration values are resolved in this order (later wins):

1. Dataclass defaults in code:
   - `shinka/core/config.py` (`EvolutionConfig`)
   - `shinka/database/dbase.py` (`DatabaseConfig`)
   - `shinka/launch/scheduler.py` (`LocalJobConfig`, `SlurmDockerJobConfig`, `SlurmCondaJobConfig`)
2. Hydra preset YAMLs in `shinka/configs/`
3. Task/cluster/variant overrides from Hydra composition
4. CLI overrides (`shinka_launch ... key=value`, or `shinka_run --set ...`)
5. Authoritative `shinka_run` flags (`--results_dir`, `--num_generations`)

---

## Runtime Config Objects

### EvolutionConfig (`shinka.core.EvolutionConfig`)

Concurrency is configured on `ShinkaEvolveRunner`. When `proposal_workers` is
set, its total capacity determines proposal concurrency.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `task_sys_msg` | `Optional[str]` | `"You are an expert optimization and algorithm design assistant. Improve the program while preserving correctness and immutable regions."` | Task-specific system prompt. |
| `fixed_prompt` | `Optional[str]` | `None` | Instructions appended to proposal prompts, including evolved prompts and repairs. |
| `proposal_workers` | `Optional[List[dict]]` | `None` | Headless proposal workers, each with a unique `name`, positive `capacity`, and `launch_command` argv list. |
| `proposal_workspace` | `dict` | `{}` | Absolute `mirrors`, a per-generation `prepare` command, and relative `artifacts` to return from proposal workers. |
| `patch_types` | `List[str]` | `['diff', 'full', 'cross']` | Patch formats; supports `diff`, `full`, `cross`. |
| `patch_type_probs` | `List[float]` | `[0.6, 0.3, 0.1]` | Sampling probabilities for `patch_types` (must sum to 1). |
| `num_generations` | `int` | `50` | Target number of generations. |
| `max_patch_resamples` | `int` | `3` | Max patch resample loops per novelty attempt. |
| `max_patch_attempts` | `int` | `1` | Max attempts to produce a syntactically valid patch. |
| `job_type` | `str` | `'local'` | Job backend: `local`, `slurm_docker`, `slurm_conda`. |
| `language` | `str` | `'python'` | Language tag for prompts + file handling. |
| `llm_models` | `List[str]` | `['gpt-5-mini', 'gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gpt-5.4']` | Mutation model pool. |
| `llm_dynamic_selection` | `Optional[Union[str, BanditBase]]` | `'ucb'` | Dynamic model selection (`fixed`, `ucb`, `ucb1`, `thompson`, or bandit object). |
| `llm_dynamic_selection_kwargs` | `dict` | `{'cost_aware_coef': 0.5}` | kwargs forwarded to selected bandit. |
| `llm_kwargs` | `dict` | `{'temperatures': [0.0, 0.5, 1.0], 'max_tokens': 16384}` | kwargs forwarded to LLM calls. |
| `meta_rec_interval` | `Optional[int]` | `10` | Generation interval for meta recommendations. |
| `meta_llm_models` | `Optional[List[str]]` | `None` | Model pool for meta-recommendations. |
| `meta_llm_kwargs` | `dict` | `{}` | kwargs for meta-recommendation LLM calls. |
| `meta_max_recommendations` | `int` | `5` | Max recommendations produced per meta step. |
| `sample_single_meta_rec` | `bool` | `True` | Whether to sample one recommendation when multiple exist. |
| `persist_meta_state` | `bool` | `False` | Save recommendations, summaries, scratchpad, and pending programs to `meta_state.json`; restore them when resuming. |
| `embedding_model` | `Optional[str]` | `'text-embedding-3-small'` | Embedding model for code similarity. Also supports `local/<model>@http(s)://host[:port]/v1` for local OpenAI-compatible embedding endpoints, with optional `?api_key_env=ENV_VAR` for per-model credentials. |
| `init_program_path` | `Optional[str]` | `'initial.py'` | Initial program path. |
| `initial_population` | `Optional[List[dict]]` | `None` | Explicit seed entries, one per island, evaluated as generation zero. |
| `results_dir` | `Optional[str]` | `None` | Results directory; auto-assigned when `None`. |
| `enable_wandb_logging` | `bool` | `False` | Mirror evolution metrics to W&B. Existing SQLite and WebUI logging remains enabled. Install the `wandb` extra first. |
| `wandb_project` | `Optional[str]` | `'shinka-evolve'` | W&B project used when wandb logging is enabled. |
| `wandb_entity` | `Optional[str]` | `None` | Optional W&B entity/team. |
| `wandb_group` | `Optional[str]` | `None` | Optional W&B run group. |
| `wandb_name` | `Optional[str]` | `None` | Optional W&B run name; defaults to the results directory name. |
| `wandb_mode` | `Optional[str]` | `None` | Optional W&B mode, e.g. `offline` or `disabled`. |
| `wandb_tags` | `List[str]` | `[]` | Optional W&B tags. |
| `wandb_notes` | `Optional[str]` | `None` | Optional W&B run notes. |
| `wandb_dir` | `Optional[str]` | `None` | Optional local W&B directory; defaults to `results_dir`. |
| `wandb_run_id` | `Optional[str]` | `None` | Optional W&B run ID; otherwise generated and persisted in the results directory. |
| `wandb_resume` | `str` | `'allow'` | W&B resume policy used with the persisted run ID. |
| `wandb_config` | `Dict[str, Any]` | `{}` | Extra W&B config values merged into the run config. |
| `max_novelty_attempts` | `int` | `3` | Max novelty loops per generation. |
| `code_embed_sim_threshold` | `float` | `0.99` | Similarity threshold used by novelty checks. |
| `novelty_llm_models` | `Optional[List[str]]` | `None` | Optional novelty-judge model pool. |
| `novelty_llm_kwargs` | `dict` | `{}` | kwargs for novelty-judge LLM calls. |
| `use_text_feedback` | `bool` | `False` | Include text feedback in mutation prompts. |
| `max_api_costs` | `Optional[float]` | `None` | API budget cap in USD; stops new submissions at cap. |
| `enable_controlled_oversubscription` | `bool` | `False` | Enable bounded proposal oversubscription when proposal generation is slower than evaluation. |
| `proposal_target_mode` | `str` | `'adaptive'` | Proposal target controller mode: `adaptive` or `fixed`. |
| `proposal_target_min_samples` | `int` | `5` | Minimum completed timing samples required before adaptive targeting activates. |
| `proposal_target_ratio_cap` | `float` | `2.0` | Maximum sampling/evaluation ratio used by the adaptive controller. |
| `proposal_buffer_max` | `int` | `2` | Maximum extra proposal jobs above `max_evaluation_jobs`. |
| `proposal_target_hard_cap` | `Optional[int]` | `None` | Absolute cap for the adaptive proposal target. |
| `proposal_target_ewma_alpha` | `float` | `0.3` | EWMA smoothing factor for proposal/evaluation timing estimates. |
| `inspiration_sort_order` | `str` | `'ascending'` | Inspiration ordering (`ascending`, `chronological`, `none`). |
| `evolve_prompts` | `bool` | `False` | Enable system-prompt evolution. |
| `prompt_patch_types` | `List[str]` | `['diff', 'full']` | Patch formats for prompt evolution. |
| `prompt_patch_type_probs` | `List[float]` | `[0.7, 0.3]` | Sampling probabilities for prompt patch formats. |
| `prompt_evolution_interval` | `Optional[int]` | `None` | Prompt-evolution interval in generations. |
| `prompt_archive_size` | `int` | `10` | Prompt archive size. |
| `prompt_llm_models` | `Optional[List[str]]` | `None` | Prompt-evolution model pool (falls back to `llm_models`). |
| `prompt_llm_kwargs` | `dict` | `{}` | kwargs for prompt-evolution LLM calls. |
| `prompt_ucb_exploration_constant` | `float` | `1.0` | UCB exploration constant for prompt sampler. |
| `prompt_epsilon` | `float` | `0.1` | Epsilon-greedy exploration for prompt sampler. |
| `prompt_evo_top_k_programs` | `int` | `3` | Number of top programs used during prompt evolution. |
| `prompt_percentile_recompute_interval` | `int` | `20` | Generations between prompt percentile recomputations. |

W&B logging examples:

```bash
# Install the optional integration.
pip install 'shinka-evolve[wandb]'

# Authenticate online runs. In CI, provide this through a secret manager.
export WANDB_API_KEY=<your-api-key>

# Add W&B metrics and a compact final table alongside the WebUI database.
shinka_run --task-dir examples/circle_packing --results_dir results/circle_wandb --num_generations 20 \
  --set evo.enable_wandb_logging=true \
  --set evo.wandb_project=shinka-evolve
```

Population and island snapshots use the monotonic
`population/evaluated_count` axis. They include counts, correctness, scores,
cumulative `cost/*`, and cumulative `timing/*_total`. Raw evaluated candidates
use `score/individual` and `individual/*` fields without binding those events to
generation. Administrative island copies remain in population/table counts but
are excluded from evaluated count, candidate history, and costs. The compact
`population/final_table` omits program code, embeddings, and unrestricted
metadata. When a results directory is resumed, its `.wandb_run_id` is reused
with `wandb_resume='allow'` by default. Online mode uses credentials from
`wandb login` or `WANDB_API_KEY`; set `wandb_mode=offline` to record locally
without uploading. W&B failures are non-fatal and do not alter the existing
database or WebUI path.

The integration disables W&B console, Git, code, requirements, machine, and
system-stat capture. Its run config contains only an explicit allowlist of safe
scalar experiment settings; `wandb_config` remains an explicit extension and is
recursively redacted for secret-like keys. Arbitrary `wandb_config` values cross
the upload boundary when their keys are not recognized as sensitive, so do not
put secrets or private data there. Candidate events omit private metrics and
include at most 64 public numeric metrics whose full keys are at most 128
characters; secret-like keys are discarded. Population snapshots use a compact
database aggregate on a dedicated serialized telemetry worker, run at most once
every five seconds, and overlapping refresh requests are coalesced. If the
bounded raw-candidate queue saturates, the newest candidate event is dropped
with a rate-limited warning; population and final snapshots remain authoritative.

### DatabaseConfig (`shinka.database.DatabaseConfig`)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `db_path` | `Optional[str]` | `None` | SQLite DB path. |
| `num_islands` | `int` | `2` | Number of islands. |
| `archive_size` | `int` | `40` | Global archive size cap. |
| `elite_selection_ratio` | `float` | `0.3` | Fraction of elite inspirations. |
| `num_archive_inspirations` | `int` | `1` | Number of archive inspirations sampled. |
| `num_top_k_inspirations` | `int` | `1` | Number of top-k inspirations sampled. |
| `migration_interval` | `int` | `10` | Generations between migration events. |
| `migration_rate` | `float` | `0.0` | Fraction of programs migrated at migration events. |
| `island_elitism` | `bool` | `True` | Preserve best programs on islands. |
| `enforce_island_separation` | `bool` | `True` | Restrict inspiration sampling to source island. |
| `island_selection_strategy` | `str` | `'uniform'` | Island sampler: `uniform`, `equal`, `proportional`, `weighted`. |
| `enable_dynamic_islands` | `bool` | `False` | Enable stagnation-triggered island spawning. |
| `stagnation_threshold` | `int` | `100` | No-improvement generations before spawn. |
| `island_spawn_strategy` | `str` | `'initial'` | Spawn seed: `initial`, `best`, `archive_random`. |
| `island_spawn_subtree_size` | `int` | `1` | Number of copied programs when spawning. |
| `parent_selection_strategy` | `str` | `'weighted'` | Parent selector: `weighted`, `power_law`, `beam_search`, or `latest` (newest candidate regardless of correctness, no inspirations or forced fix mode). |
| `repair_probability` | `float` | `0.0` | Probability of selecting an eligible incorrect candidate from the selected island for repair. |
| `repair_sampling` | `str` | `'uniform'` | Repair selection: `uniform` or `weighted`. |
| `repair_filters` | `dict` | `{}` | Equality filters on dotted program fields, such as `private_metrics.status`. |
| `repair_weight_metric` | `Optional[str]` | `None` | Dotted numeric field used for repair weighting; configured values must be finite and nonnegative for eligibility. |
| `explicit_initial_population` | `bool` | `False` | Assign supplied seeds to their specified islands and count those islands as initialized, including incorrect seeds. Set automatically by `initial_population`. |
| `exploitation_alpha` | `float` | `1.0` | Power-law strength for parent selection. |
| `exploitation_ratio` | `float` | `0.2` | Probability of selecting from archive. |
| `parent_selection_lambda` | `float` | `10.0` | Sigmoid sharpness for weighted parent selection. |
| `num_beams` | `int` | `5` | Beam count for beam-search parent selection. |
| `archive_selection_strategy` | `str` | `'fitness'` | Archive replacement strategy: `fitness` or `crowding`. |
| `archive_criteria` | `Dict[str, float]` | `{'combined_score': 1.0}` | Weighted criteria for fitness archive scoring. |

### Native task options

`shinka_run` recognizes `initial.lean` and selects the Lean language automatically.
The fields above also work in YAML (`evo`/`db` or `evo_config`/`db_config`) and
through `--set`; a task does not need a runner subclass to use them.

An explicit initial population supplies one entry per configured island. Each
entry requires `name`, `path`, and `sha256` (a lowercase SHA-256 hex digest).
Optional `require_correct` defaults to `false`. The runner evaluates all seeds
before inserting the population.
Incorrect seeds can initialize islands when correctness is not required. All
seeds count together as generation zero, followed by generations 1 through
`num_generations - 1`. Resuming preserves the saved seeds and their identities,
including a run stopped immediately after initialization.

Repair selection keeps the sampled island. Only incorrect candidates matching
all `repair_filters` are eligible. When `repair_weight_metric` is configured,
candidates missing a finite nonnegative value are excluded, including in uniform
mode. Weighted selection uses `1 / ((1 + metric) * (1 + children_count))`; without
a metric, it uses `1 / (1 + children_count)`. If no candidate qualifies, ordinary
parent selection continues. Repair context uses the selected candidate's ancestry.

For example, a task can revisit unfinished candidates with probability 0.25:

```yaml
evo:
  fixed_prompt: Preserve the required interface and checked assumptions.
  persist_meta_state: true
db:
  repair_probability: 0.25
  repair_sampling: weighted
  repair_filters:
    private_metrics.status: unresolved
  repair_weight_metric: public_metrics.vertices
```

### Distributed proposals

Proposal workers run Headless commands on Linux machines. Each generation uses
one worker slot for all proposal and repair retries. The slot is released after
the requested artifacts return, before the candidate waits for central
evaluation. The coordinator schedules evaluations using the configured job
backend; local jobs run there. SQLite writes, recommendations, prompt evolution,
and novelty judgments stay on the coordinator.

```yaml
max_evaluation_jobs: 1
evo:
  llm_models: ["headless/codex@gpt-6-luna?effort=max"]
  proposal_workers:
    - name: local
      capacity: 1
      launch_command: []
    - name: remote
      capacity: 1
      launch_command:
        - ssh
        - worker-host
        - python3
        - /srv/ShinkaEvolve/shinka/core/worker_endpoint.py
  proposal_workspace:
    mirrors: [/srv/task, /srv/headless-cli]
    prepare: [python3, /srv/task/prepare.py]
    artifacts: [notes, "logs/*.json"]
```

An empty `launch_command` starts the endpoint locally. Other commands must start
`shinka/core/worker_endpoint.py` with Python over stdin/stdout; SSH is one option.
Install the endpoint, runtime, and Headless credentials on each worker before
launching. The mirror paths must be absolute and have the same meaning on each
worker. Mirrors supply task sources and dependencies; exclude credentials and
active results directories. Initial setup transfers files whose contents differ.
Existing mirrored inputs are immutable during a run; later proposals can receive
new files, such as newly published library versions.

For each leased generation, the optional preparation command first runs on the
coordinator with `SHINKA_PROPOSAL_PREPARE=coordinator`. The generation directory
is then copied to the worker, where the command runs with
`SHINKA_PROPOSAL_PREPARE=worker`. Both commands use that generation directory as
their working directory. This lets tasks select shared input versions centrally
and set worker deadlines after transfer. Omit `prepare` when no setup is needed.
`artifacts` lists relative files, directories, or glob patterns to copy back;
candidate source and evaluation outputs remain coordinator-owned.

The sum of worker capacities replaces `max_proposal_jobs`. Proposal production
can fill those slots while central evaluations run, with a bounded waiting
queue. Without `proposal_workers`, the existing local concurrency settings
apply. Worker names, attempt IDs, selected models, efforts, and start/end times
are recorded in candidate metadata.

### Job Configs (`shinka.launch.*JobConfig`)

`JobConfig` base fields:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `eval_program_path` | `Optional[str]` | `'evaluate.py'` | Evaluation script path. |
| `extra_cmd_args` | `Dict[str, Any]` | `{}` | Extra CLI args forwarded to eval script. |

`LocalJobConfig` adds:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `time` | `Optional[str]` | `None` | Optional timeout (`HH:MM:SS`). |
| `conda_env` | `Optional[str]` | `None` | Optional conda env for local execution. |
| `activate_script` | `Optional[str]` | `None` | Optional sourceable env script, e.g. `.venv/bin/activate`. |

`SlurmDockerJobConfig` adds:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `image` | `str` | `'ubuntu:latest'` | Docker image. |
| `image_tar_path` | `Optional[str]` | `None` | Optional image tar for upload/load. |
| `docker_flags` | `str` | `''` | Extra docker flags. |
| `partition` | `str` | `'gpu'` | SLURM partition. |
| `time` | `str` | `'01:00:00'` | SLURM time limit. |
| `cpus` | `int` | `1` | CPU request. |
| `gpus` | `int` | `1` | GPU request. |
| `mem` | `Optional[str]` | `'8G'` | Memory request. |

`SlurmCondaJobConfig` / `SlurmEnvJobConfig` add:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `conda_env` | `str` | `''` | Conda environment name. |
| `activate_script` | `Optional[str]` | `None` | Sourceable env script path, e.g. `.venv/bin/activate`. |
| `modules` | `Optional[List[str]]` | `None` | Modules to load (normalized to `[]` at runtime). |
| `partition` | `str` | `'gpu'` | SLURM partition. |
| `time` | `str` | `'01:00:00'` | SLURM time limit. |
| `cpus` | `int` | `1` | CPU request. |
| `gpus` | `int` | `1` | GPU request. |
| `mem` | `Optional[str]` | `'8G'` | Memory request. |

`conda_env` and `activate_script` are mutually exclusive.

---

## Hydra Presets

### Evolution Presets

All `shinka/configs/evolution/*.yaml` set runner-level concurrency at the top level and override `EvolutionConfig` defaults only for listed `evo_config` keys.

#### `shinka/configs/evolution/small_budget.yaml`

```yaml
max_evaluation_jobs: 1
max_proposal_jobs: 2
max_db_workers: 2

evo_config:
  patch_types: ["diff", "full"]
  patch_type_probs: [0.5, 0.5]
  num_generations: 20
  max_patch_attempts: 10
  llm_models: ["gpt-4.1"]
  llm_dynamic_selection: null
  embedding_model: "text-embedding-3-small"
  enable_controlled_oversubscription: false
  results_dir: ${output_dir}
```

#### `shinka/configs/evolution/medium_budget.yaml`

```yaml
max_evaluation_jobs: 4
max_proposal_jobs: 6
max_db_workers: 2

evo_config:
  patch_types: ["diff", "full", "cross"]
  patch_type_probs: [0.6, 0.3, 0.1]
  num_generations: 50
  max_patch_resamples: 3
  max_patch_attempts: 1
  llm_models:
    - "gpt-5-mini"
    - "gemini-3-flash-preview"
    - "gemini-3.1-pro-preview"
    - "gpt-5.4"
  llm_dynamic_selection: ucb
  llm_dynamic_selection_kwargs:
    cost_aware_coef: 0.5
  llm_kwargs:
    temperatures: [0.0, 0.5, 1.0]
    max_tokens: 16384
  meta_rec_interval: 10
  embedding_model: "text-embedding-3-small"
  code_embed_sim_threshold: 0.99
  enable_controlled_oversubscription: false
  proposal_target_mode: adaptive
  proposal_target_min_samples: 5
  proposal_target_ratio_cap: 2.0
  proposal_buffer_max: 2
  proposal_target_ewma_alpha: 0.3
  results_dir: ${output_dir}
```

#### `shinka/configs/evolution/large_budget.yaml`

```yaml
max_evaluation_jobs: 6
max_proposal_jobs: 8
max_db_workers: 2

evo_config:
  patch_types: ["diff", "full", "cross"]
  patch_type_probs: [0.4, 0.4, 0.2]
  num_generations: 300
  max_patch_resamples: 3
  max_patch_attempts: 3
  llm_models:
    - "gpt-4.1"
    - "gpt-4.1-mini"
    - "gpt-4.1-nano"
    - "us.anthropic.claude-sonnet-4-6-v1:0"
    - "o4-mini"
  llm_dynamic_selection: ucb
  llm_kwargs:
    temperatures: [0.0, 0.5, 1.0]
    max_tokens: 16384
  meta_rec_interval: 10
  meta_llm_models: ["gpt-4.1"]
  meta_llm_kwargs:
    temperatures: [0.0]
  embedding_model: "text-embedding-3-small"
  enable_controlled_oversubscription: false
  proposal_target_mode: adaptive
  proposal_target_min_samples: 5
  proposal_target_ratio_cap: 2.0
  proposal_buffer_max: 2
  proposal_target_hard_cap: 8
  proposal_target_ewma_alpha: 0.3
  results_dir: ${output_dir}
```

### Controlled Oversubscription

These adaptive settings apply when `proposal_workers` is unset. With configured
workers, the pipeline target is evaluation capacity plus total worker capacity.

When proposal generation is slower than evaluation, Shinka can keep extra
proposal tasks in flight so evaluation workers spend less time idle.

- `max_evaluation_jobs` still caps evaluation concurrency.
- `max_proposal_jobs` becomes the hard ceiling for proposal generation tasks.
- the controller raises the proposal target above evaluation concurrency only
  when observed `sampling_seconds > evaluation_seconds`
- the oversubscription is bounded by `proposal_buffer_max`,
  `proposal_target_ratio_cap`, `proposal_target_hard_cap`, and
  `max_proposal_jobs`

Recommended starting point:

```yaml
max_evaluation_jobs: 5
max_proposal_jobs: 7
max_db_workers: 2

evo_config:
  enable_controlled_oversubscription: true
  proposal_target_mode: adaptive
  proposal_target_min_samples: 5
  proposal_target_ratio_cap: 2.0
  proposal_buffer_max: 2
  proposal_target_hard_cap: 7
  proposal_target_ewma_alpha: 0.3
```

Use `max_proposal_jobs: 1` if you want sync-like proposal behavior with no
proposal backlog.

### Database Presets

All `shinka/configs/database/*.yaml` override `DatabaseConfig` defaults only for listed keys.

#### `shinka/configs/database/island_small.yaml`

```yaml
db_config:
  db_path: "evolution_db.sqlite"
  num_islands: 2
  archive_size: 20
  exploitation_ratio: 0.2
  elite_selection_ratio: 0.3
  num_archive_inspirations: 4
  num_top_k_inspirations: 2
  migration_interval: 10
  migration_rate: 0.1
  island_elitism: true
```

#### `shinka/configs/database/island_medium.yaml`

```yaml
db_config:
  db_path: "evolution_db.sqlite"
  num_islands: 2
  archive_size: 40
  elite_selection_ratio: 0.3
  num_archive_inspirations: 1
  num_top_k_inspirations: 1
  migration_interval: 10
  migration_rate: 0.0
  island_elitism: true
  enforce_island_separation: true
  parent_selection_strategy: "weighted"
  parent_selection_lambda: 10.0
```

#### `shinka/configs/database/island_large.yaml`

```yaml
db_config:
  db_path: "evolution_db.sqlite"
  num_islands: 5
  archive_size: 40
  elite_selection_ratio: 0.3
  num_archive_inspirations: 4
  num_top_k_inspirations: 2
  migration_interval: 10
  migration_rate: 0.1
  island_elitism: true
  parent_selection_strategy: "weighted"
  exploitation_alpha: 1.0
  exploitation_ratio: 0.2
  parent_selection_lambda: 10.0
```

### Cluster Presets

- `shinka/configs/cluster/local.yaml`
  - `job_config: LocalJobConfig`
  - `job_config.eval_program_path: ${distributed_job_config.eval_program_path}`
  - `evo_config.job_type: "local"`
- `shinka/configs/cluster/remote.yaml`
  - `job_config: ${distributed_job_config}`
- `shinka/configs/cluster/gcp.yaml`
  - inherits `remote`
  - overrides `distributed_job_config.partition: "a3,aisci"`

### Task Presets (Current)

Only these task files currently exist:

- `shinka/configs/task/circle_packing.yaml`
- `shinka/configs/task/novelty_generator.yaml`

Both define task-specific `evaluate_function`, `distributed_job_config`, and `evo_config` task prompt/init path.

---

## Current Hydra Composition Defaults

`shinka/configs/config.yaml` defaults chain:

```yaml
defaults:
  - _self_
  - database@_global_: island_medium
  - evolution@_global_: medium_budget
  - task@_global_: circle_packing
  - cluster@_global_: local
  - variant@_global_: default
```

So default `shinka_launch` behavior is a neutral medium shared baseline on the
`circle_packing` task with `variant=default`. Example-heavy stacks remain
available via explicit variants such as `variant=circle_packing_example`.

---

## `shinka_run` Config File Schema

`shinka_run --config-fname <yaml>` accepts:

- Namespaces: `evo`, `db`, `job` (aliases: `evo_config`, `db_config`, `job_config`)
- Runner keys: `max_evaluation_jobs`, `max_proposal_jobs`, `max_db_workers`, `verbose`, `debug`

Precedence for `shinka_run`:

1. defaults from CLI builder
2. config YAML (`--config-fname`)
3. `--set` overrides
4. authoritative flags:
   - `--results_dir` always sets `evo.results_dir`
   - `--num_generations` always sets `evo.num_generations`

---

## Config Directory Structure

```text
shinka/configs/
├── config.yaml
├── cluster/
│   ├── gcp.yaml
│   ├── local.yaml
│   └── remote.yaml
├── database/
│   ├── island_large.yaml
│   ├── island_medium.yaml
│   └── island_small.yaml
├── evolution/
│   ├── large_budget.yaml
│   ├── medium_budget.yaml
│   └── small_budget.yaml
├── task/
│   ├── circle_packing.yaml
│   └── novelty_generator.yaml
└── variant/
    ├── circle_packing_example.yaml
    ├── default.yaml
    └── novelty_generator_example.yaml
```

---

## Quick Valid Overrides

Hydra launch:

```bash
shinka_launch \
  task=novelty_generator \
  database=island_medium \
  evolution=medium_budget \
  cluster=local \
  evo_config.num_generations=50 \
  evo_config.max_api_costs=25.0
```

`shinka_run`:

```bash
shinka_run \
  --task-dir examples/circle_packing \
  --results_dir results/circle_agent \
  --num_generations 40 \
  --max-evaluation-jobs 6 \
  --set evo.llm_models='["gpt-5-mini","gemini-3-flash-preview"]' \
  --set evo.llm_dynamic_selection=ucb \
  --set db.num_islands=2
```
