# rPi — Recursive Self-Improvement on pi

用 `pi`（`@earendil-works/pi-coding-agent`，开源）作为 **自我迭代** 的实验平台。
核心思路：让 pi **修改自己的 system prompt**（`SYSTEM.md`），跑固定的代码 benchmark，
算 fitness，保留改进了的版本 — 多窗口 island model 并行。

## 状态

- v0 Phase A: **单窗口 prompt-level RSI**（一个 generation = 一次提改动 + 评分）
- v0 Phase B: **多窗口 island model**（N 个 pi 子进程并行岛屿）

## 目录

```
rPi/
├── .pi/SYSTEM.md              ← 迭代对象（pi 每次启动自动加载）
├── .pi/skills/rsi-self-edit/  ← 教 pi 怎么提改动
├── tasks/                     ← benchmark 任务集 + grader.py
├── judge/                     ← LLM judge（用 MiniMax-M3 给输出打分）
├── islands/seed/              ← 初始种子（每个 island 从这里拷贝）
├── runs/gen-NN-island-K/      ← 每次 run 的产物
├── lib/                       ← Node 工具库（spawn pi、读 jsonl、…）
├── orchestrate.mjs            ← Phase B 入口
└── evolve.mjs                 ← Phase A 入口（单窗口循环）
```

## 跑

```powershell
cd D:\合曜AI\rPi
node evolve.mjs --gen 5              # Phase A: 跑 5 个 generation 的单窗口 RSI
node orchestrate.mjs --islands 4 --gens 8   # Phase B: 4 个并行岛屿, 8 代
```

## 评估

- `tasks/grader.py` 跑全部任务（运行 expected test），得 **pass rate** = 通过率
- `judge/judge.py` 用 MiniMax-M3 给通过的输出在 **correctness / style / efficiency** 三维打分
- **fitness** = `pass_rate * 0.6 + quality * 0.4`（先简单加权，后续会调）

## 关键决策

- **不动其他项目**：cwd 严格限制在 `rPi/`，所有读写都加 path guard
- **每次改动有 git commit**：每代 commit 一次，失败可直接 `git reset` 回滚
- **多窗口隔离**：每个 island 是独立的工作副本（`islands/island-K/`），互不影响

## 模型

- 迭代用：`minimax-cn/MiniMax-M2.7`（便宜快速）
- 验证 / judge 用：`minimax-cn/MiniMax-M3`（质量高）