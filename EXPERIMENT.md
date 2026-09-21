# rPi — 实验日志

## v0.3 — Phase A end-to-end RSI run ✅

**3 代, 单窗口, 15 LeetCode-style 题目, designer pi 每代改 system prompt。**

### 结果

| Gen | SYSTEM.md (chars) | Pass   | Notes                              |
|-----|--------------------|--------|------------------------------------|
| 0   | 23                 | 14/15  | task 14 (trap_rain) 偶发空 text   |
| 1   | 282                | 14/15  | task 12 (max_water) 偶发空 text   |
| 2   | **606**            | **15/15** | best @ gen 2 ✓                     |

```
[evolve] [g0] fitness = 93.3% (best @ g0 = 93.3%)
[evolve] [g1] fitness = 93.3% (best @ g0 = 93.3%)
[evolve] [g2] fitness = 100.0% (best @ g2 = 100.0%)
```

### Designer 提议链

**g0 → g1**:
> *"Added specific guidance for water-level problems (empty input handling,
> bounds checking, verifying examples)."*
> 实际加到 SYSTEM.md 的: "For trap_rain or similar water-level problems:
> handle empty lists (return 0), verify index bounds in loops, and test your
> water calculation against the examples."

**g1 → g2**:
> *"Added constraint to never return empty/uninitialized results when a
> valid output is expected."*
> 实际加到 SYSTEM.md 的: "Always return a valid initialized result. Never
> return empty strings, empty lists, or None when a result is expected. If
> the input is invalid, return a sensible default (e.g., 0 for integers,
> [] for lists)."

**g2 最终 SYSTEM.md**:
```markdown
You are a Python coder.

Output ONLY a single ```python fenced code block. No prose, no comments, no prints.

For trap_rain or similar water-level problems: handle empty lists (return 0),
verify index bounds in loops, and test your water calculation against the examples.

Always return a valid initialized result. Never return empty strings, empty
lists, or None when a result is expected. If the input is invalid, return a
sensible default (e.g., 0 for integers, [] for lists).
```

### Caveats(实验可信度)

1. **"Failure" 模式实际上是上游 API 偶发空 text**,不是代码逻辑错。Phase A
   的 prompt 改动(g2 加 "always return valid result")碰巧压住了这种采样
   模式,但根因不在 pi 的 system prompt。
2. **Designer 对 0 chars 的诊断是错的**:g1 误读为 "trap_rain 没处理 empty
   list",g2 才猜到正确的方向(避免上游偶发空响应)。designer 自身的诊断
   能力是 RSI 改进的瓶颈。
3. **Baseline 已经几乎满分**:15 道 LeetCode 短题,`MiniMax-M2.7` 单独跑
   多数时候 100% pass。RSI 的提升空间在题目集和模型选择,而非 prompt 工程。

### 各代 timing

```
g0: 15 tasks × ~10s avg = ~135s
g1 designer: ~10s (一个 prompt)
g1: ~135s
g2 designer: ~10s
g2: ~135s
total: ~7 分钟 wall-clock(实测因 cold-start 拉长到 ~30 分钟,主要是 pi
子进程启动 + minimax-cn 网络往返)
```

### Re-running

```powershell
cd D:\合曜AI\rPi

# 3 代 Phase A (默认配置)
node evolve.mjs --gens=3

# 10 代 + 子集 + 弱模型 — 更梯度化
node evolve.mjs --gens=10 --tasks=01,04,06,11,12,13,14,15 \
    --model=minimax-cn/MiniMax-M2.7-highspeed

# 单次 baseline
node phase0_demo.mjs

# 看历史
Get-ChildItem runs/
cat runs/evolve-<stamp>/events.jsonl | ConvertFrom-Json
```

### 输出文件

- `runs/evolve-<stamp>/events.jsonl` — 每代 init / gen / design / done 事件
- `runs/evolve-<stamp>/best.json` — 整个 session 的 best
- `runs/evolve-<stamp>/final.json` — session 总结
- `runs/evolve-<stamp>/gen-NN/benchmark.json` — 每代 per-task pass/fail + 完整 solution
- `runs/evolve-<stamp>/gen-NN/design.json` — designer 的 summary + 新 SYSTEM.md
- `runs/evolve-<stamp>/gen-NN/island/.pi/SYSTEM.md` — 该代实际跑的 prompt
- `runs/evolve-<stamp>/gen-NN/island/AGENTS.override.md` — designer 合同副本

---

## 后续实验计划

- **Phase B**: 多窗口 island model,看 RSI 在并行进化下是否收敛更快
- **LLM judge 接进 fitness**: 加 quality 维度,100% pass 之后能继续
- **更难的题 + 更弱的模型**: 制造真正的 baseline 梯度,让 RSI 有空间
- **代码级 RSI**: 让 pi 修改 `lib/spawn-pi.mjs`,跑 benchmark 后看是否改进了
  spawn latency / error rate — 这是更高阶的 RSI(修改工具本身而非 system prompt)

---

## v0.4 — Continual (open-ended RSI)

新增 `continual.mjs`,核心区别:

| 维度 | `evolve.mjs` | `continual.mjs` |
|---|---|---|
| 停止条件 | `--gens=N` | `--hours` / `--gens` / `Ctrl+C` |
| Fitness | 单维 pass_rate | 多目标:pass_rate + quality + brevity + novelty |
| 选择 | 当前 best | **Pareto front** + novelty-weighted archive |
| Designer actions | edit SYSTEM.md | mutate-prompt / add-skill / adjust-weights / no-op |
| 默认种子 | `rPi/.pi/SYSTEM.md` | Pareto 或 archive 的 novelty-weighted 采样 |

### 设计要点

- **No fixed target** — fitness 是 4 维向量的加权和,权重由 designer 自己提议修改(`adjust-weights` action)
- **Pareto front selection** — 12 个不被彼此 dominate 的解共存
- **Novelty pressure** — 0.15 权重给 "与最近 50 个 archive entry 的 Jaccard 距离",防止收敛
- **Archive roulette** — 50% 概率从 Pareto front 选,50% 从 archive 按 novelty-weighted 采样
- **Designer 三种 action** — 不只改 prompt,还能新增 skill 或调整 fitness 维度权重

### 跑法

```powershell
node continual.mjs                       # 无限
node continual.mjs --hours=2            # 2 小时
node continual.mjs --gens=10            # 10 代
```

### 输出

- `runs/continual-<stamp>/archive.jsonl` — 全部 generation 的 prompt + fitness
- `runs/continual-<stamp>/pareto.json` — Pareto front (≤12 个解)
- `runs/continual-<stamp>/events.jsonl` — 事件流
- `runs/continual-<stamp>/summary.json` — 终止原因 + final weights