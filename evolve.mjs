// evolve.mjs — Phase A: single-prompt RSI.
//
// For each generation:
//   1. Run every benchmark task in island/.pi/SYSTEM.md, get fitness.
//   2. (gen > 0) Spawn a "designer" pi that reads the previous failures
//      and current SYSTEM.md, proposes ONE focused edit, and writes the
//      new SYSTEM.md back.
//   3. (gen > 0) Re-run benchmark; if fitness improved, keep the new prompt.
//      Otherwise revert (it stays as a sibling candidate but seed = old).
//
// Designer has read/write/edit tools; solver has --no-tools. They are
// isolated by cwd (different island sub-dirs).
//
// Usage:
//   node evolve.mjs --gens=8 --model=minimax-cn/MiniMax-M2.7

import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn as spawnChild } from "node:child_process";
import { PiRpc } from "./lib/spawn-pi.mjs";
import { appendJsonl, writeJson } from "./lib/jsonl.mjs";

const ROOT = process.cwd();
const TASKS_DIR = path.join(ROOT, "tasks");
const GRADER = path.join(TASKS_DIR, "grader.py");
const RUNS_DIR = path.join(ROOT, "runs");
const SEED_SYSTEM = await fs.readFile(path.join(ROOT, ".pi", "SYSTEM.md"), "utf8");
const DESIGNER_GUIDE = await fs.readFile(path.join(ROOT, "docs", "DESIGNER_GUIDE.md"), "utf8");

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
            if (next !== undefined && !next.startsWith("--")) { out[fl[1]] = next; i++; }
            else out[fl[1]] = true;
        }
    }
    return out;
}
const args = parseArgs(process.argv.slice(2));
const numGens = parseInt(args.gens || "5", 10);
const modelOverride = args.model || "minimax-cn/MiniMax-M2.7";
const designerModel = args["designer-model"] || "minimax-cn/MiniMax-M2.7";
const onlyTasks = String(args.tasks || "").split(",").filter(Boolean);

// --- task list ---
const allFiles = await fs.readdir(TASKS_DIR);
const taskFiles = allFiles.filter((f) => /^\d{2}-.+\.md$/.test(f)).sort();
const taskFileById = Object.fromEntries(taskFiles.map((f) => [f.slice(0, 2), f]));
const taskIds = onlyTasks.length ? onlyTasks.filter((t) => taskFileById[t]) : Object.keys(taskFileById).sort();

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const SESSION_DIR = path.join(RUNS_DIR, `evolve-${stamp}`);
await fs.mkdir(SESSION_DIR, { recursive: true });

const EVENTS_PATH = path.join(SESSION_DIR, "events.jsonl");
const BEST_PATH = path.join(SESSION_DIR, "best.json");
const SEED_ISLAND = path.join(SESSION_DIR, "island-seed");

console.log(`[evolve] session: ${SESSION_DIR}`);
console.log(`[evolve] tasks: ${taskIds.length}, gens: ${numGens}, solver model: ${modelOverride}`);
console.log(`[evolve] designer model: ${designerModel}`);

// --- helpers ---

async function setupIsland(dir, systemMd) {
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(path.join(dir, ".pi"), { recursive: true });
    await fs.writeFile(path.join(dir, ".pi", "SYSTEM.md"), systemMd, "utf8");
    await fs.writeFile(
        path.join(dir, ".pi", "settings.json"),
        JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }),
        "utf8",
    );
}

async function gradeOne(taskId, solution) {
    return new Promise((resolve) => {
        const proc = spawnChild(
            "python",
            [GRADER, "--task", taskId, "--json", JSON.stringify({ task: taskId, solution })],
            { cwd: ROOT, encoding: "utf8" },
        );
        let stdout = "";
        proc.stdout.on("data", (d) => stdout += d.toString());
        proc.on("exit", () => {
            try { resolve(JSON.parse(stdout)); }
            catch { resolve({ task: taskId, pass: false, error: "grader parse fail", stage: "grader" }); }
        });
    });
}

// Solver prompt template — must mirror phase0_demo so apples-to-apples.
const SOLVER_USER_PROMPT = (desc) => `Solve the following Python coding task. Output ONLY a single \`\`\`python fenced code block with the full solution. No prose, no comments, no explanation outside the code block. Do not use any tools.\n\n${desc}`;

async function solveTask(islandDir, taskId, desc, maxRetries = 2) {
    const promptText = SOLVER_USER_PROMPT(desc);
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const pi = new PiRpc({
            cwd: islandDir,
            provider: "minimax-cn",
            model: modelOverride,
            thinking: "off",
            name: `solver-${taskId}-a${attempt}`,
            noSkills: true,
            noExtensions: true,
            noContextFiles: true,
            tools: "",
            onLog: () => {},
        });
        try {
            await pi.start();
            const t0 = Date.now();
            const resp = await pi.prompt(promptText);
            const elapsed = Date.now() - t0;
            const text = resp.text || "";
            await pi.dispose();
            if (text.length > 0) {
                const m = text.match(/```python\s*\n([\s\S]*?)```/);
                const solution = m ? m[1].trim() : text.trim();
                const graded = await gradeOne(taskId, solution);
                return { task: taskId, pass: !!graded.pass, error: graded.error, stage: graded.stage, elapsed_ms: elapsed, attempt, solution };
            }
        } catch (e) {
            try { await pi.dispose(); } catch {}
        }
    }
    return { task: taskId, pass: false, error: "empty after retries", stage: "retries", elapsed_ms: 0, attempt: maxRetries, solution: "" };
}

async function runBenchmark(islandDir, label) {
    console.log(`[evolve] [${label}] solving ${taskIds.length} tasks...`);
    const results = [];
    for (const taskId of taskIds) {
        const desc = await fs.readFile(path.join(TASKS_DIR, taskFileById[taskId]), "utf8");
        const r = await solveTask(islandDir, taskId, desc);
        results.push(r);
        console.log(`[evolve] [${label}] ${taskId}: ${r.pass ? "PASS" : "FAIL"} (${r.elapsed_ms}ms)${r.pass ? "" : ` — ${r.error}`}`);
    }
    const total = results.length;
    const pass = results.filter((r) => r.pass).length;
    const rate = total ? pass / total : 0;
    return { total, pass, pass_rate: rate, results };
}

// Designer prompt: ask pi to propose ONE focused edit to SYSTEM.md.
// Designer has read/write/edit tools; we constrain it via a hard-coded prompt.
async function designerPropose(islandDir, prevResults, prevSystemMd) {
    // Write the designer guide as AGENTS.md so pi knows its contract.
    // (We keep this in AGENTS.override.md so cwd's SYSTEM.md is what gets
    //  edited, not the guide itself.)
    const guidePath = path.join(islandDir, "AGENTS.override.md");
    await fs.writeFile(guidePath, DESIGNER_GUIDE, "utf8");

    // Build the failure digest the designer needs.
    const failures = prevResults.results.filter((r) => !r.pass);
    const digest = failures.map((r) => ({
        task: r.task,
        error: r.error,
        stage: r.stage,
        solution_preview: (r.solution || "").slice(0, 200),
    }));
    const failuresText = JSON.stringify(digest, null, 2);

    const userPrompt = [
        "## Previous generation result",
        `Pass rate: ${(prevResults.pass_rate * 100).toFixed(1)}% (${prevResults.pass}/${prevResults.total})`,
        "",
        "## Failed tasks (these are the regressions to fix)",
        "```json",
        failuresText,
        "```",
        "",
        "## Current SYSTEM.md (read it from the cwd, edit it IN PLACE)",
        "Make ONE focused edit. Do not rewrite the whole thing.",
        "",
        "When done, reply with the GEN/ISLAND/CHANGE/WHY/RISK summary as specified in AGENTS.override.md.",
    ].join("\n");

    const pi = new PiRpc({
        cwd: islandDir,
        provider: "minimax-cn",
        model: designerModel,
        thinking: "off",
        name: `designer`,
        noSkills: true,
        noExtensions: true,
        noContextFiles: true,
        // allow tools so designer can read/write/edit SYSTEM.md
        tools: ["read", "write", "edit", "grep", "find", "ls"],
        onLog: () => {},
    });

    let summary = "";
    try {
        await pi.start();
        const resp = await pi.prompt(userPrompt);
        summary = (resp.text || "").trim();
    } catch (e) {
        summary = `[designer error: ${e.message}]`;
    } finally {
        try { await pi.dispose(); } catch {}
    }

    const newSystem = await fs.readFile(path.join(islandDir, ".pi", "SYSTEM.md"), "utf8");
    return { summary, new_system: newSystem, changed: newSystem !== prevSystemMd };
}

// --- init ---
// Seed island: use the project's .pi/SYSTEM.md as gen 0.
await setupIsland(SEED_ISLAND, SEED_SYSTEM);
await appendJsonl(EVENTS_PATH, { kind: "init", seed_system_chars: SEED_SYSTEM.length, stamp, tasks: taskIds.length });

// --- loop ---
let best = { generation: -1, pass_rate: 0, pass: 0, total: taskIds.length, system: SEED_SYSTEM };
let currentSystem = SEED_SYSTEM;

for (let gen = 0; gen < numGens; gen++) {
    const genDir = path.join(SESSION_DIR, `gen-${String(gen).padStart(2, "0")}`);
    await fs.mkdir(genDir, { recursive: true });
    const islandDir = path.join(genDir, "island");
    await setupIsland(islandDir, currentSystem);

    // 1) benchmark
    const bench = await runBenchmark(islandDir, `g${gen}`);
    bench.system_chars = currentSystem.length;
    bench.generation = gen;
    await writeJson(path.join(genDir, "benchmark.json"), bench);

    // 2) decide best-of-session so far
    if (bench.pass_rate > best.pass_rate) {
        best = {
            generation: gen,
            pass_rate: bench.pass_rate,
            pass: bench.pass,
            total: bench.total,
            system: currentSystem,
        };
        await writeJson(BEST_PATH, best);
    }

    await appendJsonl(EVENTS_PATH, {
        kind: "gen", gen, pass_rate: bench.pass_rate, pass: bench.pass, total: bench.total,
        system_chars: bench.system_chars,
    });

    console.log(`[evolve] [g${gen}] fitness = ${(bench.pass_rate * 100).toFixed(1)}% (best @ g${best.generation} = ${(best.pass_rate * 100).toFixed(1)}%)`);

    // 3) designer (except after last gen)
    if (gen === numGens - 1) break;

    const design = await designerPropose(islandDir, bench, currentSystem);
    await writeJson(path.join(genDir, "design.json"), design);
    await appendJsonl(EVENTS_PATH, {
        kind: "design", gen,
        changed: design.changed,
        summary: design.summary.slice(0, 400),
        new_system_chars: design.new_system.length,
    });

    // 4) accept / reject — accept unconditionally for now (we always move on
    //    to the new prompt; accept/reject logic kicks in by gen comparison).
    currentSystem = design.new_system;
}

// --- finalize ---
await appendJsonl(EVENTS_PATH, { kind: "done", best });
await writeJson(path.join(SESSION_DIR, "final.json"), {
    stamp, num_gens: numGens, model: modelOverride, designer_model: designerModel,
    tasks: taskIds.length, best,
});

console.log("");
console.log(`[evolve] DONE. Best: gen ${best.generation} = ${(best.pass_rate * 100).toFixed(1)}% (${best.pass}/${best.total})`);
console.log(`[evolve] session: ${SESSION_DIR}`);
console.log(`[evolve] best.json: ${BEST_PATH}`);
process.exit(0);