# Benchmark Tasks

每个任务是一道独立的编程题。`grader.py` 会:

1. 给 pi 读 `tasks/<id>.md` 的 description
2. 让 pi 生成 solution(写到临时文件)
3. 用 `tests/<id>.py` 里的 assert 验证
4. 记 pass/fail,以及 LLM judge 给的 quality 分

## 添加新任务

新建 `tasks/NN-name.md`(description)和 `tests/test_NN_name.py`(assert)。

description 格式:函数签名 + 描述 + 示例 I/O + 约束。