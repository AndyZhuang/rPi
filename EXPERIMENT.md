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