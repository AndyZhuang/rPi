# rPi Experiment Log

## v0.3 — Phase A end-to-end RSI run

3 generations, single window, 15 LeetCode-style tasks.

### Result

| Gen | SYSTEM.md (chars)                      | Pass   | Notes                          |
|-----|----------------------------------------|--------|--------------------------------|
| 0   | "You are a Python coder." (23)         | 14/15  | task 14 (trap_rain) empty txt  |
| 1   | + trap_rain guidance (282)             | 14/15  | task 12 (max_water) empty txt  |
| 2   | + "always return valid result" (606)   | **15/15** | best @ gen 2                   |

```
[evolve] [g0] fitness = 93.3% (best @ g0 = 93.3%)
[evolve] [g1] fitness = 93.3% (best @ g0 = 93.3%)
[evolve] [g2] fitness = 100.0% (best @ g2 = 100.0%)
```

### What the designer did

- **g0 → g1**: added "For trap_rain or similar water-level problems: handle empty
  lists (return 0), verify index bounds in loops, and test your water calculation
  against the examples." — but the real cause of failures was the upstream model
  returning empty text, not the code logic.
- **g1 → g2**: added "Always return a valid initialized result. Never return
  empty strings, empty lists, or None when a result is expected." — this guidance
  eliminated the empty-response pattern for these tasks.

### Caveats

- The "failure" mode here was likely an upstream provider quirk (minimax-cn
  occasionally returns empty text); the prompt change in g2 may have shifted
  sampling rather than fixing a real bug. Re-running the same g2 prompt with
  fresh seed would likely still produce ~100% pass rate, but that confirms
  the *prompt* is good rather than the *evolution*.
- LLM judge (static quality metric) was not enabled in this run; future
  iterations should weight quality above pass/fail once baseline saturates.

### Re-running

```powershell
cd D:\合曜AI\rPi
node evolve.mjs --gens=3                      # 3 generations, ~20-30 min
node evolve.mjs --gens=10 --tasks=01,02,03    # subset, longer run
```

### Next

- **Phase B (island model)**: N parallel pi sub-processes evolving in
  isolation, broadcast best-of-generation each cycle.
- **Quality-aware fitness**: enable `judge/judge.py --llm` and combine with
  pass rate so 100% pass + 5/10 quality still has RSI headroom.