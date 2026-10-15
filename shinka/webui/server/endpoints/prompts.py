"""System prompts evolved alongside programs (``prompts.sqlite``)."""

from __future__ import annotations

import logging
from typing import Dict

from ..context import ServerContext
from ..db_reader import open_prompt_db, with_retries
from ..paths import resolve_database, results_dir_for
from ..responses import HttpError, Response, json_response

logger = logging.getLogger("shinka.webui")


def get_system_prompts(ctx: ServerContext, query: Dict[str, str]) -> Response:
    """All prompts, or an empty list when the run has no prompt database.

    Prompts are optional, so database errors degrade to an empty list rather
    than failing the page.
    """
    db_file = resolve_database(ctx.search_root, query["db_path"])
    prompts_file = results_dir_for(db_file) / "prompts.sqlite"
    if not prompts_file.is_file():
        return json_response([])

    def read():
        with open_prompt_db(prompts_file) as db:
            return [prompt.to_dict() for prompt in db.get_all_prompts()]

    try:
        prompts = ctx.cache.get_or_compute(
            ("prompts", str(prompts_file)),
            prompts_file,
            lambda: with_retries(read, description="prompt read"),
        )
    except HttpError:
        logger.warning("Prompt database busy; returning no prompts")
        return json_response([])
    except Exception as error:
        logger.warning("Could not read prompt database %s: %s", prompts_file, error)
        return json_response([])
    return json_response(prompts)
