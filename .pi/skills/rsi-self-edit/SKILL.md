---
name: rsi-self-edit
description: Use when asked to improve SYSTEM.md or propose a code-generation style change for the rPi benchmark. The parent orchestrator will handle grading.
---

# RSI Self-Edit

You are running inside the **rPi** experiment. Your only job this turn is to
propose a **single focused improvement** to `.pi/SYSTEM.md`.

## Steps

1. Read `runs/last_fitness.json` and `runs/last_diff.json` if they exist.
2. Read the current `SYSTEM.md` in the island directory you're in.
3. Skim 2–3 tasks in `tasks/*.md` to understand the benchmark style.
4. Identify **one** weakness. Examples:
   - Style: solutions print debugging instead of returning
   - Correctness: edge cases (empty, 1-element, negative) missed
   - Efficiency: O(n²) when O(n) possible
   - Format: extra prose before the code block
5. Make **one small change** (1–3 sentences edited, no big rewrites).
6. Write the updated `SYSTEM.md` back.
7. Reply with the GEN/ISLAND/CHANGE/WHY/RISK summary.

## Edge cases

- If last generation regressed: prefer a **minimal** revert + one tiny tweak.
- If fitness plateaued for 3+ generations: change the *framing* (e.g., add a
  self-check instruction), not the wording.
- If you're unsure whether to add a new constraint: **don't** — adding
  constraints usually hurts pass rate.