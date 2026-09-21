// phase0_demo.mjs — baseline: run every benchmark task once with the current
// seed SYSTEM.md and report per-task pass/fail + aggregate fitness.
//
// Each task runs in a *fresh* pi subprocess (RPC mode, --no-tools, --no-skills,
// --no-extensions, --no-context-files). The solver system prompt is written
// to `<island>/.pi/SYSTEM.md` so it survives shell-arg parsing (newlines).
//
// Usage:
//   node phase0_demo.mjs                 # all 10 tasks
//   node phase0_demo.mjs --tasks=01,02   # subset

import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn as spawnChild } from "node:child_process";
import { PiRpc } from "./lib/spawn-pi.mjs";

const ROOT = process.cwd();
const TASKS_DIR = path.join(ROOT, "tasks");
const GRADER = path.join(TASKS_DIR, "grader.py");
const RUNS_DIR = path.join(ROOT, "runs");

// --- arg parse ---
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
const modelOverride = args.model || "minimax-cn/MiniMax-M2.7";

// --- task list ---
const allFiles = await fs.readdir(TASKS_DIR);
const taskFiles = allFiles
    .filter((f) => /^\d{2}-.+\.md$/.test(f))
    .sort();
const taskFileById = Object.fromEntries(taskFiles.map((f) => [f.slice(0, 2), f]));
const taskIds = Object.keys(taskFileById).sort();
const tasks = onlyTasks.length ? taskIds.filter((t) => onlyTasks.includes(t)) : taskIds;

console.log(`[phase0] tasks: ${tasks.join(", ")}`);
console.log(`[phase0] model: ${modelOverride}`);

// --- island setup ---
// Per-run island folder; keeps baseline reproducible.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const ISLAND_DIR = path.join(ROOT, "islands", `phase0-${stamp}`);
await fs.mkdir(ISLAND_DIR, { recursive: true });
await fs.mkdir(path.join(ISLAND_DIR, ".pi"), { recursive: true });

// Seed SYSTEM.md (the iteration target — phase0 measures the baseline).
const seedSystem = await fs.readFile(path.join(ROOT, ".pi", "SYSTEM.md"), "utf8");
await fs.writeFile(path.join(ISLAND_DIR, ".pi", "SYSTEM.md"), seedSystem, "utf8");

// Disable retry + compaction so each task resolves in one round (no retry mid-task
// that would race with our dispose). Phase A RSI doesn't need either for short
// solver prompts.
await fs.writeFile(
    path.join(ISLAND_DIR, ".pi", "settings.json"),
    JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }, null, 2),
    "utf8",
);

// Output directory for this baseline run.
const runDir = path.join(RUNS_DIR, `phase0-${stamp}`);
await fs.mkdir(runDir, { recursive: true });

// Solver pi uses the SAME .pi/SYSTEM.md as the seed (no override).
// We just disable context-files (no AGENTS.md walk-up) and disable tools.

async function runOneTask(taskId, desc, maxRetries = 2) {
    const promptText = `Solve the following Python coding task. Output ONLY a single \`\`\`python fenced code block with the full solution. No prose, no comments, no explanation outside the code block. Do not use any tools.\n\n${desc}`;
    let lastResp = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const pi = new PiRpc({
            cwd: ISLAND_DIR,
            provider: "minimax-cn",
            model: modelOverride,
            thinking: "off",
            name: `phase0-${stamp}-${taskId}-a${attempt}`,
            noSkills: true,
            noExtensions: true,
            noContextFiles: true,
            tools: "",
            onLog: (k, msg) => {
                const t = (msg || "").slice(0, 200);
                console.error(`[${taskId}.a${attempt}:pi:${k}] ${t}`);
            },
        });
        try {
            await pi.start();
            const t0 = Date.now();
            const resp = await pi.prompt(promptText);
            const elapsed = Date.now() - t0;
            lastResp = { text: resp.text || "", elapsed_ms: elapsed, tools: resp.toolCount, attempt };
            await pi.dispose();
            if (lastResp.text.length > 0) return lastResp;
            console.warn(`[${taskId}] attempt ${attempt}: empty text, retrying...`);
        } catch (e) {
            try { await pi.dispose(); } catch {}
            if (attempt === maxRetries) throw e;
            console.warn(`[${taskId}] attempt ${attempt}: error ${e.message}, retrying...`);
        }
    }
    return lastResp || { text: "", elapsed_ms: 0, tools: 0, attempt: maxRetries };
}

let totalPass = 0;
let totalRun = 0;
const results = [];

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
        const proc = spawnChild("python", [GRADER, "--task", taskId, "--json", JSON.stringify({ task: taskId, solution })], {
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
    model: modelOverride,
    seed_system_prompt_chars: seedSystem.length,
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
process.exit(0);