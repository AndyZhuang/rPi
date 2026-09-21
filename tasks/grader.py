"""
grader.py — run a candidate Python solution against a task's canonical tests.

Two modes:

  1. CLI:  python grader.py --task 01 --solution file.py
            (prints JSON result to stdout)

  2. JSON-in/JSON-out:  python grader.py --json '{"task":"01","solution":"def ..."}'
            (prints JSON result; convenient for piping from Node)

A "solution" is Python source that defines a function matching the expected
signature (see tests.EXPECTED_FN). The runner extracts that function by name,
then calls tests.run_NN(fn).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path

# Make tests.py importable when invoked from any cwd.
HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import tests as canonical_tests  # noqa: E402


def grade(task_id: str, solution_src: str, timeout_s: float = 5.0) -> dict:
    """
    Execute `solution_src` in a fresh namespace, pull out the expected function,
    and run canonical_tests.run_<task_id>(fn). Return a dict.
    """
    expected_fn = canonical_tests.EXPECTED_FN[task_id]
    runner = canonical_tests.RUNNERS[task_id]

    ns: dict = {"__name__": "rpi_candidate"}
    started = time.time()

    try:
        exec(compile(solution_src, f"<rpi-candidate-task-{task_id}>", "exec"), ns)
    except Exception as e:
        return {
            "task": task_id,
            "pass": False,
            "fn": expected_fn,
            "stage": "exec",
            "error": f"{type(e).__name__}: {e}",
            "trace": traceback.format_exc(limit=3),
            "elapsed_s": round(time.time() - started, 3),
        }

    if expected_fn not in ns:
        return {
            "task": task_id,
            "pass": False,
            "fn": expected_fn,
            "stage": "missing",
            "error": f"function `{expected_fn}` not defined in candidate",
            "defined": [k for k in ns.keys() if not k.startswith("_") and callable(ns[k])],
            "elapsed_s": round(time.time() - started, 3),
        }

    fn = ns[expected_fn]

    try:
        # Crude timeout: rely on the asserts being quick. For real safety, run
        # the candidate in a subprocess with a wall-clock timeout. Out of scope
        # for v0 because pi-generated solutions are trusted (we own them).
        runner(fn)
    except AssertionError as e:
        return {
            "task": task_id,
            "pass": False,
            "fn": expected_fn,
            "stage": "assert",
            "error": str(e) or "AssertionError",
            "trace": traceback.format_exc(limit=3),
            "elapsed_s": round(time.time() - started, 3),
        }
    except Exception as e:
        return {
            "task": task_id,
            "pass": False,
            "fn": expected_fn,
            "stage": "runtime",
            "error": f"{type(e).__name__}: {e}",
            "trace": traceback.format_exc(limit=3),
            "elapsed_s": round(time.time() - started, 3),
        }

    return {
        "task": task_id,
        "pass": True,
        "fn": expected_fn,
        "stage": "ok",
        "error": None,
        "elapsed_s": round(time.time() - started, 3),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", help="task id (e.g. 01)")
    ap.add_argument("--solution", help="path to .py file containing the candidate")
    ap.add_argument("--json", help="JSON object with {task, solution} (solution is source string)")
    args = ap.parse_args()

    if args.json:
        body = json.loads(args.json)
        task = body["task"]
        src = body["solution"]
    else:
        if not (args.task and args.solution):
            ap.error("provide --task + --solution, or --json")
        task = args.task
        src = Path(args.solution).read_text(encoding="utf-8")

    if task not in canonical_tests.RUNNERS:
        print(json.dumps({"ok": False, "error": f"unknown task {task}"}))
        return 2

    result = grade(task, src)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())