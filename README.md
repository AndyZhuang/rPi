# rPi — Recursive Self-Improvement on pi

让 [`pi`](https://pi.dev) (`@earendil-works/pi-coding-agent`, MIT, v0.85.1) **修改自己**
的 system prompt,在固定的代码 benchmark 上看 fitness 是否提升 — 真正的
**Recursive Self-Improvement (RSI)** 实验平台。

> 项目代号: **rPi** = recursive Pi。

## 状态

- ✅ **Phase A**: 单窗口 prompt-level RSI(已跑通 — g2 找到 100% pass 的 prompt)
- ⏳ **Phase B**: 多窗口 island model(架构已规划,代码未实现)

## 设计概要

```
┌─ evolve.mjs / orchestrator.mjs (Node.js 父脚本) ──────────────┐
│                                                                 │
│  generation N: 当前 SYSTEM.md 种子                              │
│       ↓                                                         │
│  ┌────────────────────────┐                                    │
│  │ solver pi (--no-tools)  │  跑 15 个 task → pass/fail       │
│  └────────────────────────┘                                    │
│       ↓ fitness                                                │
│  ┌────────────────────────┐                                    │
│  │ designer pi (有工具)     │  读失败 case + 当前 prompt        │
│  │                         │  提议 1 个聚焦改动 → 改 SYSTEM.md  │
│  └────────────────────────┘                                    │
│       ↓ new prompt                                             │
│  generation N+1                                                 │
└─────────────────────────────────────────────────────────────────┘
```

每个 task 启一个**全新的 pi 子进程**(RPC 模式,`--no-session --no-tools --no-extensions`),
隔离干净,无状态污染。designer 与 solver 隔离在不同 island 子目录。

## 目录结构

```
rPi/
├── README.md                — 你正在读这个
├── EXPERIMENT.md            — Phase A 实验日志
├── ARCHITECTURE.md          — 整体架构 + 设计决策
├── AGENTS.md                — 给 pi 看的项目说明 (仅作为参考,运行时会写到 island/AGENTS.override.md)
│
├── .pi/SYSTEM.md            — 项目级默认 system prompt (g0 起点)
├── docs/DESIGNER_GUIDE.md   — designer pi 的合同
│
├── tasks/                   — benchmark 任务集
│   ├── 01-fizzbuzz.md  …  15-lru-cache.md   # 15 道 LeetCode 短题
│   ├── tests.py                                # 每题的 canonical assert
│   ├── grader.py                               # CLI: 给 solution → pass/fail
│   └── test_solutions/                         # 手写正解(开发期 debug)
│
├── judge/judge.py           — 静态指标 + 可选 LLM judge (M3)
│
├── lib/                     — Node 工具
│   ├── spawn-pi.mjs         — pi RPC 模式封装(用 agent_settled 触发)
│   └── jsonl.mjs            — JSONL helpers
│
├── evolve.mjs               — Phase A 单窗口 RSI 入口 ★
├── phase0_demo.mjs          — 单次 baseline 工具
│
├── runs/                    — 每次 run 的产物(自动创建)
│   ├── phase0-.../          # phase0_demo 输出 (summary.json + sol_*.py)
│   └── evolve-.../          # evolve.mjs 输出 (events.jsonl + best.json + gen-NN/*)
│
└── islands/                 — 隔离副本(每代一个)
    └── evolve-.../gen-NN/island/.pi/SYSTEM.md
```

## 跑

```powershell
cd D:\合曜AI\rPi

# 单次 baseline — 用默认 SYSTEM.md 跑一遍,看 fitness
node phase0_demo.mjs

# Phase A — RSI 循环(默认 5 代,全 15 题,大约 25-40 分钟)
node evolve.mjs

# 子集 + 更多代
node evolve.mjs --gens=10 --tasks=01,02,03,04,05

# 用便宜的 highspeed 模型迭代(更快但更弱)
node evolve.mjs --gens=5 --model=minimax-cn/MiniMax-M2.7-highspeed
```

## 关键设计决策

| 决策 | 为什么 |
|---|---|
| **每个 task 一个全新 pi 子进程** | 同一实例连续 prompt 会撞 "Agent is already processing" |
| **system prompt 写到 `<island>/.pi/SYSTEM.md`** | CLI `--system-prompt` 在 shell:true spawn 下被多行文本/空格撕碎,文件最稳 |
| **关掉 `--context-files`** | 防止 pi 上溯加载到 rPi/AGENTS.md 等"项目说明",污染 system prompt |
| **用 `agent_settled` 触发 resolver** | `agent_end` 后 pi 还可能 retry/compact,空 text 是中间态 |
| **retry-on-empty** | minimax-cn 偶发空 text,每个 task 自动 retry 1-2 次 |
| **designer 与 solver 工具集不同** | solver `--no-tools`(只用文本输出),designer `read/write/edit/grep/find/ls` |
| **disable retry/compaction in island settings.json** | 短 benchmark 不需要自动 retry,避免和 dispose race |
| **每代 git commit** | RSI 实验万一 regression,直接 `git reset` 回滚 |

## 模型

| 用途 | 模型 |
|---|---|
| 迭代 / 验证 | `minimax-cn/MiniMax-M2.7` |
| LLM judge | `minimax-cn/MiniMax-M3` |
| 更快但更弱 | `minimax-cn/MiniMax-M2.7-highspeed` |

切换:`--model=<provider>/<id>` 或 `--designer-model=...`。

## 已知问题与待办

- **Pass rate 100% 后没 RSI 空间**:Phase A 已经把 15 题答到 100%,没有提升空间。后续要么加 LLM judge 当 fitness 维度,要么换更难题目,要么用更弱模型制造梯度。
- **"empty after retries" 失败**:minimax-cn 偶尔返回空 text,Phase A g2 的 prompt 改动碰巧压住了它,但根因在 API 端。
- **designer 对 0 chars 错误的误读**:g1 把 "empty after retries" 误判为 "task 没处理 empty list",g2 才猜对方向 — designer 自己的诊断能力是 RSI 改进的瓶颈。
- **Phase B island model 未实现**:`orchestrate.mjs` 还没写,但 Node child_process + pi RPC 的多进程架构已经验证可行。

详见 [`EXPERIMENT.md`](./EXPERIMENT.md) 和 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。