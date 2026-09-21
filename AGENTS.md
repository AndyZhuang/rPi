# rPi — Project Agent Notes (loaded by pi)

当 pi 启动时，这个文件被自动加载到上下文。

## 这是什么

`rPi` 是一个 RSI（Recursive Self-Improvement）实验。**你**（pi）被一个父 orchestrator
脚本启动，每次启动会拿到：

1. 当前代的种子 `SYSTEM.md`（位于 `.pi/SYSTEM.md` 或 `islands/island-K/.pi/SYSTEM.md`）
2. 上一代的 fitness + 失败案例

你的任务：**只改 `SYSTEM.md`**，让它下次跑 benchmark 时 fitness 更高。
**不要跑 grader**，**不要自己跑测试** — orchestrator 会做评估。

## 工作流

1. 读 `runs/last_fitness.json` 了解上一代表现
2. 读当前 `SYSTEM.md`
3. 读 `tasks/*.md` 的任务描述（理解 benchmark 在测什么）
4. 读 `judge/judge.py`（理解 judge 看哪些维度）
5. 提一个**聚焦的**改进（一次只改 1-3 段 prompt，避免大改）
6. 用 `edit` 工具把改动写到 `<island_dir>/.pi/SYSTEM.md`
7. 回复一句简短 summary 说明你改了什么 + 为什么

## 硬约束

- **cwd 必须在 `rPi/` 或 `islands/island-K/`**，不要写其他任何路径
- **不要执行 grader / judge / 跑测试**，评估是 orchestrator 的活
- **不要删除 / 移动 `tasks/`、`judge/`、`lib/`、`orchestrate.mjs`、`evolve.mjs`** — 这些是 orchestrator 的工具
- 改动 SYSTEM.md 时保持 markdown 格式，不要写超过 100 行
- 如果上一代是 regression，回滚之前好的版本（看 git log）

## 完成后回话格式

```
GEN: <N>
ISLAND: <K>
CHANGE: <一句话描述>
WHY: <为什么这个改动可能提升 fitness>
RISK: <这个改动可能在哪个任务上退化>
```