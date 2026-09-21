// phase0_demo.mjs — bootstrap: run every benchmark task once with the current
// SYSTEM.md and report per-task results. This validates the pi RPC plumbing,
// the grader, and gives us a baseline fitness before we add the RSI loop.
//
// Usage:
//   node phase0_demo.mjs                 # run all tasks
//   node phase0_demo.mjs --tasks 01,02   # subset

import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PiRpc } from "./lib/spawn-pi.mjs";

const ROOT = process.cwd();
const TASKS_DIR = path.join(ROOT, "tasks");
const GRADER = path.join(TASKS_DIR, "grader.py");
const RUNS_DIR = path.join(ROOT, "runs");
const ISLAND_DIR = path.join(ROOT, "islands", "phase0");

// Parse args: --key=value OR --key value (when value doesn't start with --)
function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const eq = a.match(/^--([^=]+)=(.*)$/);
        if (eq) { out[eq[1]] = eq[2]; continue; }
        const fl = a.match(/^--(.+)$/);
        if (fl) {
            const next = argv[i + 1];
            if (next !== undefined && !next.startsWith("--")) {
                out[fl[1]] = next;
                i++;
            } else {
                out[fl[1]] = true;
            }
        }
    }
    return out;
}
const args = parseArgs(process.argv.slice(2));
const onlyTasks = String(args.tasks || "").split(",").filter(Boolean);

// Resolve available tasks in tasks/*.md (excluding README.md, grader.py, tests.py).
const allFiles = await fs.readdir(TASKS_DIR);
const taskFiles = allFiles
    .filter((f) => /^\d{2}-.+\.md$/.test(f))
    .sort();
// Map id -> filename. id is the leading 2 digits.
const taskFileById = Object.fromEntries(taskFiles.map((f) => [f.slice(0, 2), f]));
const taskIds = Object.keys(taskFileById).sort();
const tasks = onlyTasks.length ? taskIds.filter((t) => onlyTasks.includes(t)) : taskIds;

console.log(`[phase0] tasks: ${tasks.join(", ")}`);
console.log(`[phase0] island: ${ISLAND_DIR}`);

// Prepare island: copy .pi/ from project root and write a marker.
await fs.mkdir(ISLAND_DIR, { recursive: true });
await fs.mkdir(path.join(ISLAND_DIR, ".pi"), { recursive: true });
const seedSystem = await fs.readFile(path.join(ROOT, ".pi", "SYSTEM.md"), "utf8");
await fs.writeFile(path.join(ISLAND_DIR, ".pi", "SYSTEM.md"), seedSystem, "utf8");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(RUNS_DIR, `phase0-${stamp}`);
await fs.mkdir(runDir, { recursive: true });

const SOLVER_SYSTEM_PROMPT = [
    "You are a Python code generator in a benchmark loop.",
    "Your sole job: receive a programming task description and reply with",
    "ONE single ```python fenced code block containing the full solution.",
    "",
    "Strict rules:",
    "- DO NOT use any tools. You have no read/write/edit/bash. Output text only.",
    "- DO NOT write any prose, greetings, or commentary outside the code block.",
    "- DO NOT wrap the code block in any other fences or formatting.",
    "- The code block must define exactly the function whose signature appears in the task.",
    "- Keep the solution short (typically under 30 lines).",
].join("\n");

let totalPass = 0;
let totalRun = 0;
const results = [];

async function runOneTask(taskId, desc) {
    // Fresh pi instance per task — avoids "Agent is already processing"
    // when the same instance is reused across many prompts.

    // Write SOLVER_SYSTEM_PROMPT as island-level AGENTS.md so it survives
    // CLI parsing quirks (newlines, multi-line strings). pi auto-loads
    // AGENTS.md from cwd and walks up.
    await fs.writeFile(path.join(ISLAND_DIR, "AGENTS.md"), SOLVER_SYSTEM_PROMPT, "utf8");

    const pi = new PiRpc({
        cwd: ISLAND_DIR,
        provider: "minimax-cn",
        model: "minimax-cn/MiniMax-M2.7",
        thinking: "off",
        name: `phase0-${stamp}-${taskId}`,
        noSkills: true,
        noExtensions: true,
        noContextFiles: false,  // keep AGENTS.md loading on
        tools: "",
        onLog: (k, msg) => console.error(`[${taskId}:pi:${k}] ${msg}`),
    });
    try {
        await pi.start();
        const t0 = Date.now();
        const resp = await pi.prompt(`Solve the following Python coding task.\n\n${desc}`);
        const elapsed = Date.now() - t0;
        return { text: resp.text || "", elapsed_ms: elapsed, tools: resp.toolCount };
    } finally {
        await pi.dispose();
    }
}

for (const taskId of tasks) {
    const descPath = path.join(TASKS_DIR, taskFileById[taskId]);
    const desc = await fs.readFile(descPath, "utf8");

    console.log(`[phase0] task ${taskId}: prompting pi...`);
    let result;
    try {
        result = await runOneTask(taskId, desc);
    } catch (e) {
        console.error(`[phase0] task ${taskId}: prompt failed: ${e.message}`);
        results.push({ task: taskId, pass: false, error: `prompt: ${e.message}`, tools: 0, elapsed_ms: 0 });
        totalRun++;
        continue;
    }

    const text = result.text;
    const m = text.match(/```python\s*\n([\s\S]*?)```/);
    const solution = m ? m[1].trim() : text.trim();

    const graded = await new Promise((resolve) => {
        const proc = spawn("python", [GRADER, "--task", taskId, "--json", JSON.stringify({ task: taskId, solution })], {
            cwd: ROOT,
            encoding: "utf8",
        });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d) => stdout += d.toString());
        proc.stderr.on("data", (d) => stderr += d.toString());
        proc.on("exit", (code) => {
            try { resolve({ code, json: JSON.parse(stdout), stderr }); }
            catch { resolve({ code, raw: stdout, stderr }); }
        });
    });

    const pass = !!graded.json?.pass;
    const errMsg = pass ? null : (graded.json?.error || `grader exited ${graded.code}`);
    if (pass) totalPass++;
    totalRun++;

    const rec = {
        task: taskId,
        pass,
        error: errMsg,
        stage: graded.json?.stage,
        tools: result.tools,
        elapsed_ms: result.elapsed_ms,
        solution_chars: solution.length,
    };
    results.push(rec);
    await fs.writeFile(path.join(runDir, `sol_${taskId}.py`), solution, "utf8");

    console.log(`[phase0] task ${taskId}: ${pass ? "PASS" : "FAIL"} (${result.elapsed_ms}ms, ${result.tools} tool calls, ${solution.length} chars)${pass ? "" : ` — ${errMsg}`}`);
}

const fitness = totalRun ? totalPass / totalRun : 0;
const summary = {
    phase: "phase0",
    stamp,
    model: "minimax-cn/MiniMax-M2.7",
    system_prompt_chars: seedSystem.length,
    total: totalRun,
    pass: totalPass,
    pass_rate: fitness,
    results,
};

await fs.writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
await fs.writeFile(path.join(RUNS_DIR, "phase0_last.json"), JSON.stringify(summary, null, 2), "utf8");

console.log("");
console.log(`[phase0] DONE: ${totalPass}/${totalRun} pass = ${(fitness * 100).toFixed(1)}%`);
console.log(`[phase0] run dir: ${runDir}`);
console.log(`[phase0] summary: ${path.join(RUNS_DIR, "phase0_last.json")}`);
process.exit(totalPass === totalRun ? 0 : 0);  // 0 always; pass rate is the metric