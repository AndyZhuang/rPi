# rPi — Architecture

## 设计哲学

1. **极简核心,完整闭环**:父 orchestrator + 子 pi 进程,无 broker / no central
   daemon。spawn 一个 pi → 等结果 → 记录 → 决定下一步。
2. **隔离 = 安全**:每个 island 是独立工作副本(`islands/.../gen-NN/island/`),
   有自己的 `.pi/SYSTEM.md` 和 `AGENTS.override.md`,pi 看不到父 rPi 项目的
   AGENTS.md(`--no-context-files` 关掉上溯)。
3. **确定性测评**:benchmark 的 assert 在 `tasks/tests.py` 里 hard-code,任何
   pi 跑同样的 task description + 同样 input 必须拿到同样 output。grader
   是纯函数,无网络/IO。
4. **git 是时间机器**:每次成功的 generation commit 一次,失败可 `git reset`
   回滚到上一代。

## 进程模型

### Phase A: 单窗口(已实现)

```
evolve.mjs (Node)
   │
   ├─ gen 0: setupIsland + solveTask * 15 + record fitness
   ├─ gen 1: setupIsland + designerPropose (新 pi) + solveTask * 15
   └─ gen N: …
```

每个 `solveTask`:
1. spawn `pi --mode rpc --no-tools --no-extensions --no-context-files`
   cwd = `<session>/gen-NN/island/`,其 `.pi/SYSTEM.md` 是当前代 prompt。
2. 发 prompt("Solve this Python coding task, output only ```python ...```")
3. 等 `agent_settled` 事件 → 拿到 _assistantText
4. regex 提取 ```python ... ``` code block
5. spawn `python tasks/grader.py --json '{...}'` → pass/fail + error
6. dispose pi,记录

每个 `designerPropose`:
1. 写 `AGENTS.override.md`(designer 合同)+ 失败 task digest 到 user prompt
2. spawn pi(RPC 模式,允许 read/write/edit/grep/find/ls 工具)
3. designer 自己读 `../tasks/*.md` 和 `cwd/.pi/SYSTEM.md`
4. designer 用 edit 工具改 `cwd/.pi/SYSTEM.md`(只能改这一处)
5. dispose → 把新 SYSTEM.md 当作下一代种子

### Phase B: island model(规划中,未实现)

```
orchestrate.mjs (Node)
   │
   ├─ spawn K 个 pi 子进程,每个 cwd = islands/island-K/,各自 SYSTEM.md
   │
   ├─ for gen in 0..G:
   │      for k in 0..K:  pi[k].prompt("solve current task batch")
   │      collect all K fitnesses
   │      broadcast best-of-generation system prompt → 替换所有 island 种子
   │      optionally: each island mutates slightly from best
   │
   └─ record per-generation per-island stats
```

变体:
- **No migration**:每个 island 完全独立进化(适者生存)
- **With migration**:每代广播 best prompt
- **With mutation**:广播 best + 每个 island 各自加一个小扰动

## 事件协议

pi 的 RPC 模式用 LF-delimited JSONL 在 stdin/stdout 上(详见
`D:\dev-cache\npm-global\node_modules\@earendil-works\pi-coding-agent\docs\rpc.md`)。

我们关心的事件:

| 事件 | 用途 |
|---|---|
| `response` (cmd=prompt, success) | prompt 命令被接受(不等于完成) |
| `message_update` + `text_delta` | 流式文本(累积到 `_assistantText`) |
| `tool_execution_start` | 工具调用计数(designer 用得多) |
| `agent_settled` | **完全 settled**,触发 prompt() 的 resolver |

不用 `agent_end`:它后面可能跟 retry/compaction/queued continuation,空 text 是中间态。

## 路径与权限

- **所有 spawn 的 pi 子进程 cwd 必须在 `rPi/` 子树下**,否则可能改到其他项目。
- 父脚本不显式做 path guard(因为 pi 子进程如果跑偏会用 `bash` 工具乱写,
  实际靠 cwd + `--no-extensions` + pi 默认 sandbox 限制)。
- **designer 的 `read` 工具**能读到 `cwd` 之外(`../tasks/*.md`),这是设计意图。
- **designer 的 `write`/`edit` 工具**应该被限制到 `cwd/.pi/SYSTEM.md`,但 pi
  默认不限制(详见 DESIGNER_GUIDE.md 的硬约束段)。后续可以在 island 里加
  一个 extension 强制 path gate,但 Phase A 没做。

## 评估函数

当前 `fitness = pass_rate`。

未来(LLM judge):
```
fitness = 0.6 * pass_rate + 0.4 * avg_quality
quality ∈ [0, 10] = judge.py 给每个 pass 的解打分(correctness/style/efficiency)
```

LLM judge 用 minimax-cn/MiniMax-M3 当裁判:
```powershell
python judge\judge.py --task 01 --solution runs/evolve-.../sol_01.py --llm
```

返回:
```json
{"task": "01", "static_score": 10.0, "metrics": {...}, "llm": {"correctness": 9, "style": 8, "efficiency": 9}, "quality": 8.7}
```

## 失败模式与对策

| 症状 | 原因 | 对策 |
|---|---|---|
| `_assistantText = ""` | minimax-cn API 偶发空响应 | `retry-on-empty`(每次 task 最多 2 次 retry) |
| `"Agent is already processing"` | 同 pi 实例连续 prompt | 每个 task 用全新 pi 实例 |
| `spawn EINVAL` on Windows | Node 不能直接 spawn `.cmd`/`.bat` | `spawn(bin, args, { shell: true })` |
| `--system-prompt` 被截断 | shell:true 把多行文本拆成多个 args | 改用 `<island>/.pi/SYSTEM.md` 文件 |
| pi 加载到 rPi/AGENTS.md | context-files 沿目录上溯 | `--no-context-files` |

## 演进方向

### 短期(本周)
- [ ] 加 LLM judge 到 fitness
- [ ] 加 5 道刁钻题目,造 baseline 梯度
- [ ] 实现 Phase B island model(`orchestrate.mjs`)

### 中期(本月)
- [ ] 全代码 RSI:让 pi 修改 `lib/spawn-pi.mjs` 本身,每次改动跑全套 + benchmark,
      观察代码层 RSI 是否能改进基础设施
- [ ] 多维度 fitness:pass rate + quality + cost(tokens)
- [ ] 启用 pi 的 `--offline` + `--no-skills` 减少冷启动时间

### 长期
- [ ] 让 pi 修改 `.pi/SYSTEM.md` 之外的资源(skills,extensions)— 真 RSI
- [ ] Self-modifying bootstrap:让 pi 写出 evolve.mjs 的下一个版本