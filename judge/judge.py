"""
judge.py — score a candidate solution on quality dimensions beyond pass/fail.

Two layers:

  1. Static metrics (always runs): line count, print() leaks, comment ratio,
     has import, uses builtin. Returns metrics dict.

  2. LLM judge (optional, --llm): spawns `pi --provider minimax-cn ... -p "..."`
     to get a 0-10 quality score on correctness/style/efficiency.

Usage:
  python judge.py --task 01 --solution file.py
  python judge.py --task 01 --solution file.py --llm --gen 0 --island seed

Output: JSON line with the merged result.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


def static_metrics(solution_src: str) -> dict:
    """Cheap, deterministic metrics on the candidate code."""
    lines = [ln for ln in solution_src.splitlines() if ln.strip()]
    nonblank = len(lines)

    has_print = bool(re.search(r"^\s*print\s*\(", solution_src, re.M))
    print_count = len(re.findall(r"\bprint\s*\(", solution_src))

    # crude comment ratio
    comment_lines = sum(
        1 for ln in lines if ln.lstrip().startswith("#")
    )
    comment_ratio = comment_lines / max(nonblank, 1)

    has_import = bool(re.search(r"^\s*(import|from)\s+", solution_src, re.M))

    # very rough "uses builtin" detector
    builtin_uses = []
    for tok in ("len(", "range(", "sum(", "max(", "min(", "sorted(", "set(", "dict(", "Counter", "defaultdict"):
        if tok in solution_src:
            builtin_uses.append(tok.rstrip("("))

    return {
        "lines_nonblank": nonblank,
        "lines_total": len(solution_src.splitlines()),
        "has_print": has_print,
        "print_count": print_count,
        "comment_lines": comment_lines,
        "comment_ratio": round(comment_ratio, 3),
        "has_import": has_import,
        "builtin_uses": builtin_uses[:6],
    }


def static_score(metrics: dict) -> float:
    """
    Map metrics to a 0–10 quality score. Tweakable.
    Penalizes prints and heavy comments. Rewards reasonable length.
    """
    score = 10.0
    n = metrics["lines_nonblank"]

    # length sweet-spot: 5-30 lines
    if n < 3:
        score -= 4
    elif n < 5:
        score -= 1.5
    elif n > 60:
        score -= 2
    elif n > 40:
        score -= 1

    # print leaks: task says "don't print"
    if metrics["has_print"]:
        score -= 2 + min(metrics["print_count"], 3) * 0.5

    # heavy commenting
    if metrics["comment_ratio"] > 0.4:
        score -= 1

    # using builtins is good
    if metrics["builtin_uses"]:
        score += 0.5

    return round(max(0.0, min(10.0, score)), 2)


def llm_judge(task_id: str, task_desc: str, solution_src: str,
              provider: str = "minimax-cn",
              model: str = "minimax-cn/MiniMax-M3",
              thinking: str = "off",
              timeout_s: int = 60) -> dict:
    """
    Spawn `pi -p ...` to ask the LLM judge for a 0-10 score.
    The judge is asked to rate correctness, style, efficiency separately.
    """
    judge_prompt = f"""You are an expert code reviewer.

Rate the following Python solution on three dimensions, each 0–10:

- **correctness**: does it solve the task as specified (assume the visible tests pass)?
- **style**: is the code clean, Pythonic, free of unnecessary prints/comments?
- **efficiency**: is the algorithm reasonable (avoid O(n²) when O(n) is trivial)?

Task (id {task_id}):
{task_desc}

Solution:
```python
{solution_src}
```

Reply in EXACTLY this JSON shape (no prose, no markdown fence):
{{"correctness": <0-10>, "style": <0-10>, "efficiency": <0-10>, "comment": "<one short sentence>"}}
"""

    try:
        proc = subprocess.run(
            [
                "pi",
                "--provider", provider,
                "--model", model,
                "--thinking", thinking,
                "--no-session",
                "--no-context-files",
                "--no-extensions",
                "-p", judge_prompt,
            ],
            capture_output=True,
            text=True,
            timeout=timeout_s,
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "llm timeout"}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}

    out = (proc.stdout or "").strip()
    if not out:
        return {"ok": False, "error": "empty stdout", "stderr": (proc.stderr or "")[-400:]}

    # try to find the JSON block in the output (some models add prose)
    m = re.search(r"\{[^{}]*\"correctness\"[^{}]*\}", out, re.S)
    if m:
        try:
            j = json.loads(m.group(0))
            j["ok"] = True
            return j
        except json.JSONDecodeError:
            pass

    # fall back: take the last JSON-looking block
    try:
        j = json.loads(out)
        j["ok"] = True
        return j
    except Exception:
        return {"ok": False, "error": "could not parse judge JSON", "raw": out[-600:]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", required=True)
    ap.add_argument("--solution", required=True)
    ap.add_argument("--llm", action="store_true")
    ap.add_argument("--provider", default="minimax-cn")
    ap.add_argument("--model", default="minimax-cn/MiniMax-M3")
    args = ap.parse_args()

    src_path = Path(args.solution)
    src = src_path.read_text(encoding="utf-8")

    # task description for LLM judge
    task_md = Path(__file__).resolve().parent.parent / "tasks" / f"{args.task}.md"
    task_desc = task_md.read_text(encoding="utf-8") if task_md.exists() else "(no description)"

    metrics = static_metrics(src)
    static = static_score(metrics)

    result = {
        "task": args.task,
        "static_score": static,
        "metrics": metrics,
        "llm": None,
        "quality": static,  # overridden if --llm
    }

    if args.llm:
        result["llm"] = llm_judge(args.task, task_desc, src,
                                   provider=args.provider, model=args.model)
        if result["llm"].get("ok"):
            j = result["llm"]
            result["quality"] = round(
                0.5 * j.get("correctness", 5)
                + 0.3 * j.get("style", 5)
                + 0.2 * j.get("efficiency", 5),
                2,
            )
            result["llm"] = {k: j[k] for k in ("correctness", "style", "efficiency", "comment") if k in j}

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())