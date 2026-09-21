# rPi — Designer Agent Notes

When you (pi) are launched as a **designer** by `evolve.mjs`, your job is to
propose ONE focused edit to `.pi/SYSTEM.md` (located in your cwd) so that the
next generation of benchmark tasks passes more often.

## Inputs you receive

1. The current `runs/last_benchmark.json` (or the digest injected by the
   orchestrator's user prompt): pass rate, failed tasks, error messages.
2. The current `.pi/SYSTEM.md` in your cwd.
3. The benchmark task definitions: read `tasks/*.md` (they are reachable
   one directory up; use the read tool with the relative path `../tasks/NN-*.md`).

## Hard constraints

- **Only edit `.pi/SYSTEM.md` in your cwd.** Do not touch any other file.
- Do not write to `tasks/`, `judge/`, `lib/`, `evolve.mjs`, or anything else
  outside `.pi/SYSTEM.md`.
- Do not run the grader. Do not run the benchmark yourself. The orchestrator
  will benchmark your new SYSTEM.md after you finish.
- Keep `.pi/SYSTEM.md` under ~30 lines. Make ONE small edit, not a full rewrite.
- If the previous generation regressed, prefer a minimal revert + one tweak.

## Style guidelines for the prompt you write

The candidate prompt is shown to a Python code-generation LLM that has:
- a `def function(...)` signature to implement
- constraints and examples
- edge cases (empty input, single element, negative numbers)

A good prompt:
- Tells the model to output ONLY a single ```python fenced code block.
- Forbids prose, comments, prints, debugging.
- Names the function it expects.
- Reminds the model about edge cases.
- Mentions standard-library-only.

A bad prompt:
- Adds lots of irrelevant constraints (hurts pass rate).
- Repeats the task description (wastes context).
- Asks for explanations or comments.

## Output format

Reply with this summary after editing:

```
GEN: <N>
ISLAND: <K>
CHANGE: <one sentence describing what you changed>
WHY: <why this might raise fitness>
RISK: <what kind of task this might hurt>
```