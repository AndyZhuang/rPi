// continual.mjs — open-ended, continual RSI.
//
// Differences from evolve.mjs:
//   - No fixed fitness target. Run forever (or for --hours).
//   - Multi-objective fitness: pass_rate, quality (LLM judge), brevity,
//     novelty (edit-distance vs archive). Pareto-front selection.
//   - Designer may pick one of three actions, not just SYSTEM.md edits:
//       * mutate-prompt     — edit .pi/SYSTEM.md
//       * add-skill         — write a new skill under .pi/skills/<name>/SKILL.md
//       * adjust-weights    — write a manifest that tunes judge weights
//   - Archive (every generation's prompt + fitness) is sampled via
//     novelty-weighted roulette, so we keep exploring rather than collapsing
//     to one optimum.
//   - Every generation commits to git. Catastrophic forgetting is recovered
//     via archive rollback.
//
// Usage:
//   node continual.mjs                          # run forever (Ctrl+C to stop)
//   node continual.mjs --hours=2                # run 2 hours, then exit cleanly
//   node continual.mjs --hours=0.5 --gens=20    # bounded either way
//   node continual.mjs --restore=<archive-id>   # resume a previous session

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

// --- args ---
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
const maxHours = parseFloat(args.hours ?? "Infinity");
const maxGens = args.gens ? parseInt(args.gens, 10) : Infinity;
const modelOverride = args.model || "minimax-cn/MiniMax-M2.7";
const judgeModel = args["judge-model"] || "minimax-cn/MiniMax-M3";
const onlyTasks = String(args.tasks || "").split(",").filter(Boolean);

// --- task list ---
const allFiles = await fs.readdir(TASKS_DIR);
const taskFiles = allFiles.filter((f) => /^\d{2}-.+\.md$/.test(f)).sort();
const taskFileById = Object.fromEntries(taskFiles.map((f) => [f.slice(0, 2), f]));
const taskIds = onlyTasks.length ? onlyTasks.filter((t) => taskFileById[t]) : Object.keys(taskFileById).sort();

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const SESSION_DIR = path.join(RUNS_DIR, `continual-${stamp}`);
await fs.mkdir(SESSION_DIR, { recursive: true });

const EVENTS_PATH = path.join(SESSION_DIR, "events.jsonl");
const ARCHIVE_PATH = path.join(SESSION_DIR, "archive.jsonl");
const PARETO_PATH = path.join(SESSION_DIR, "pareto.json");
const WEIGHTS_PATH = path.join(SESSION_DIR, "weights.json");

console.log(`[continual] session: ${SESSION_DIR}`);
console.log(`[continual] tasks: ${taskIds.length}, solver=${modelOverride}, judge=${judgeModel}`);
console.log(`[continual] budget: ${maxHours === Infinity ? "∞" : `${maxHours}h`}, gens: ${maxGens === Infinity ? "∞" : maxGens}`);

// --- multi-objective fitness weights ---
// Default weights. Designer can rewrite this via action=adjust-weights.
const DEFAULT_WEIGHTS = {
    pass_rate: 0.5,        // primary: 0..1
    quality: 0.25,         // judge quality score 0..1
    brevity: 0.10,         // 1 - normalized solution length (shorter is better, up to a point)
    novelty: 0.15,         // edit-distance to nearest archive entry (encourages exploration)
};
let WEIGHTS = { ...DEFAULT_WEIGHTS };

async function loadWeights() {
    try {
        const w = JSON.parse(await fs.readFile(WEIGHTS_PATH, "utf8"));
        WEIGHTS = { ...DEFAULT_WEIGHTS, ...w };
    } catch {}
}

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
    // wipe skills dir for each island (no carry-over)
    await fs.rm(path.join(dir, ".pi", "skills"), { recursive: true, force: true }).catch(() => {});
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

// LLM judge (uses judgeModel). Falls back to static-only if --no-judge.
async function judgeSolution(taskId, taskDesc, solution) {
    const prompt = [
        "You are an expert Python code reviewer.",
        `Rate this solution on three 0-10 dimensions: correctness, style, efficiency.`,
        `Reply ONLY with JSON: {"correctness":N,"style":N,"efficiency":N,"comment":"one sentence"}`,
        "",
        `Task (${taskId}):`,
        taskDesc,
        "",
        "Solution:",
        "```python",
        solution,
        "```",
    ].join("\n");
    try {
        const proc = spawnChild("pi", [
            "--provider", "minimax-cn",
            "--model", judgeModel,
            "--thinking", "off",
            "--no-session",
            "--no-context-files",
            "--no-extensions",
            "--approve",
            "--offline",
            "-p", prompt,
        ], { cwd: ROOT, encoding: "utf8" });
        let out = "";
        proc.stdout.on("data", (d) => out += d.toString());
        return await new Promise((resolve) => {
            proc.on("exit", () => {
                const m = out.match(/\{[^{}]*"correctness"[^{}]*\}/s);
                if (m) {
                    try { resolve(JSON.parse(m.group(0))); return; } catch {}
                }
                resolve(null);
            });
        });
    } catch { return null; }
}

async function runBenchmark(islandDir, label, opts = {}) {
    console.log(`[continual] [${label}] solving ${taskIds.length} tasks...`);
    const results = [];
    const judgeResults = [];
    for (const taskId of taskIds) {
        const desc = await fs.readFile(path.join(TASKS_DIR, taskFileById[taskId]), "utf8");
        const r = await solveTask(islandDir, taskId, desc);
        results.push(r);
        console.log(`[continual] [${label}] ${taskId}: ${r.pass ? "PASS" : "FAIL"} (${r.elapsed_ms}ms)`);

        if (r.pass && opts.judge !== false) {
            const j = await judgeSolution(taskId, desc, r.solution);
            judgeResults.push({ task: taskId, ...(j || {}) });
        }
    }
    const total = results.length;
    const pass = results.filter((r) => r.pass).length;
    const pass_rate = total ? pass / total : 0;
    const avg_quality = judgeResults.length
        ? (0.5 * judgeResults.filter(j => j.correctness != null).reduce((s, j) => s + j.correctness, 0)
           + 0.3 * judgeResults.filter(j => j.style != null).reduce((s, j) => s + j.style, 0)
           + 0.2 * judgeResults.filter(j => j.efficiency != null).reduce((s, j) => s + j.efficiency, 0))
          / (judgeResults.length * 10)
        : 0.5;  // neutral default when no judge
    const avg_solution_chars = results.filter((r) => r.solution).reduce((s, r) => s + r.solution.length, 0)
        / Math.max(results.filter((r) => r.solution).length, 1);
    // brevity: shorter is better, capped
    const brevity = Math.max(0, Math.min(1, 1 - (avg_solution_chars - 100) / 1000));
    return { total, pass, pass_rate, avg_quality, brevity, judgeResults, results };
}

// Edit-distance proxy: Jaccard on word tokens. Cheap and good enough for novelty.
function novelty(text, archive) {
    const tokens = new Set((text.toLowerCase().match(/[a-z_]\w+/g) || []));
    if (tokens.size === 0) return 0;
    let best = 0;
    for (const past of archive.slice(-50)) {  // only check last 50 for speed
        const pastTokens = new Set((past.system.toLowerCase().match(/[a-z_]\w+/g) || []));
        if (pastTokens.size === 0) continue;
        const inter = new Set([...tokens].filter((t) => pastTokens.has(t)));
        const union = new Set([...tokens, ...pastTokens]);
        const jacc = inter.size / union.size;
        if (jacc > best) best = jacc;
    }
    // novelty = 1 - max similarity (more different = more novel)
    return 1 - best;
}

async function designerPropose(islandDir, prevResults, archive, currentSystem, currentWeights) {
    await fs.writeFile(path.join(islandDir, "AGENTS.override.md"), DESIGNER_GUIDE, "utf8");

    const failures = prevResults.results.filter((r) => !r.pass).map((r) => ({
        task: r.task, error: r.error, stage: r.stage,
    }));

    // Sample 3 archive entries so designer sees history
    const sample = archive.slice(-3).map((a) => ({
        gen: a.gen, fitness: a.fitness?.toFixed(3),
        weights: a.weights, novelty: a.novelty?.toFixed(2),
        prompt_chars: a.system?.length,
    }));

    const userPrompt = [
        "## Previous generation result",
        `Pass rate: ${(prevResults.pass_rate * 100).toFixed(1)}% (${prevResults.pass}/${prevResults.total})`,
        `Avg quality: ${(prevResults.avg_quality * 100).toFixed(1)}%`,
        "",
        "## Current fitness weights (multi-objective)",
        "```json",
        JSON.stringify(currentWeights, null, 2),
        "```",
        "",
        "## Failed tasks",
        "```json",
        JSON.stringify(failures.slice(0, 5), null, 2),
        "```",
        "",
        "## Recent archive (last 3 generations)",
        "```json",
        JSON.stringify(sample, null, 2),
        "```",
        "",
        "## Your job",
        "Pick ONE action and execute it in your cwd. Options:",
        "1. **mutate-prompt** — edit `.pi/SYSTEM.md` (small focused edit, not full rewrite)",
        "2. **add-skill** — create a new file `.pi/skills/<your-name>/SKILL.md` that the solver can use",
        "3. **adjust-weights** — write `<island>/weights.json` with new fitness weights (sum need not be 1.0)",
        "4. **no-op** — reply explaining why you didn't change anything (e.g., already at local optimum, weights too narrow)",
        "",
        "After the action, reply with GEN/ACTION/CHANGE/WHY/RISK.",
    ].join("\n");

    const pi = new PiRpc({
        cwd: islandDir,
        provider: "minimax-cn",
        model: modelOverride,
        thinking: "off",
        name: `designer`,
        noSkills: true,
        noExtensions: true,
        noContextFiles: true,
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

    // Read new state
    const newSystem = await fs.readFile(path.join(islandDir, ".pi", "SYSTEM.md"), "utf8");
    let newWeights = currentWeights;
    try {
        const w = JSON.parse(await fs.readFile(path.join(islandDir, "weights.json"), "utf8"));
        if (w && typeof w === "object") newWeights = w;
    } catch {}
    return { summary, new_system: newSystem, new_weights: newWeights, changed: newSystem !== currentSystem };
}

// Pareto front: keep points that are not dominated on (pass_rate, quality, brevity, novelty).
function updatePareto(pareto, candidate, maxSize = 12) {
    const dominates = (a, b) => {
        let better = false;
        for (const k of ["pass_rate", "avg_quality", "brevity", "novelty"]) {
            if (a[k] < b[k]) return false;
            if (a[k] > b[k]) better = true;
        }
        return better;
    };
    const next = pareto.filter((p) => !dominates(candidate, p) && !dominates(p, candidate));
    next.push(candidate);
    // Trim if too large: keep diverse (max novelty among clusters).
    if (next.length > maxSize) {
        // simple: sort by sum and keep top
        next.sort((a, b) =>
            (b.pass_rate + b.avg_quality + b.brevity + b.novelty)
            - (a.pass_rate + a.avg_quality + a.brevity + a.novelty));
        next.length = maxSize;
    }
    return next;
}

function compositeFitness(metrics, weights) {
    return metrics.pass_rate * weights.pass_rate
         + metrics.avg_quality * weights.quality
         + metrics.brevity * weights.brevity
         + metrics.novelty * weights.novelty;
}

function sampleSeed(archive, pareto) {
    // 50/50: pareto front (greedy) vs novelty-weighted archive (explore)
    if (archive.length === 0) return { system: SEED_SYSTEM, weights: DEFAULT_WEIGHTS };
    if (pareto.length > 0 && Math.random() < 0.5) {
        const pick = pareto[Math.floor(Math.random() * pareto.length)];
        return { system: pick.system, weights: pick.weights || DEFAULT_WEIGHTS };
    }
    // novelty-weighted archive sample
    const weights = archive.map((a) => (a.novelty ?? 0.1) + 0.1);
    const sum = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * sum;
    for (let i = 0; i < archive.length; i++) {
        r -= weights[i];
        if (r <= 0) return { system: archive[i].system, weights: archive[i].weights || DEFAULT_WEIGHTS };
    }
    return { system: archive[archive.length - 1].system, weights: archive[archive.length - 1].weights || DEFAULT_WEIGHTS };
}

// --- main loop ---
let archive = [];
let pareto = [];
await loadWeights();

const startedAt = Date.now();
let lastGenAt = startedAt;
const cooldownMs = 30_000;  // 30s between generations (for pi spawn overhead)
let gen = 0;
let stopReason = "running";

while (true) {
    const elapsedH = (Date.now() - startedAt) / 3_600_000;
    if (elapsedH >= maxHours) { stopReason = "hours-limit"; break; }
    if (gen >= maxGens) { stopReason = "gens-limit"; break; }

    // Cooldown
    const sinceLast = Date.now() - lastGenAt;
    if (sinceLast < cooldownMs) {
        await new Promise((r) => setTimeout(r, cooldownMs - sinceLast));
    }

    const { system: seedSystem, weights: seedWeights } = sampleSeed(archive, pareto);
    const genDir = path.join(SESSION_DIR, `gen-${String(gen).padStart(3, "0")}`);
    await fs.mkdir(genDir, { recursive: true });
    const islandDir = path.join(genDir, "island");
    await setupIsland(islandDir, seedSystem);
    WEIGHTS = seedWeights;
    await fs.writeFile(WEIGHTS_PATH, JSON.stringify(WEIGHTS, null, 2), "utf8");

    // 1) benchmark
    const bench = await runBenchmark(islandDir, `g${gen}`, { judge: true });
    const nov = novelty(seedSystem, archive);
    const fitness = compositeFitness(bench, WEIGHTS);
    const metrics = {
        pass_rate: bench.pass_rate,
        avg_quality: bench.avg_quality,
        brevity: bench.brevity,
        novelty: nov,
    };

    const record = {
        gen, stamp: new Date().toISOString(),
        system: seedSystem, weights: WEIGHTS,
        metrics, fitness,
        pass: bench.pass, total: bench.total,
    };
    archive.push(record);
    await appendJsonl(ARCHIVE_PATH, record);
    pareto = updatePareto(pareto, { system: seedSystem, weights: WEIGHTS, ...metrics });
    await writeJson(PARETO_PATH, pareto);

    console.log(`[continual] [g${gen}] fitness=${fitness.toFixed(3)} (pass=${(bench.pass_rate * 100).toFixed(1)}% qual=${(bench.avg_quality * 100).toFixed(1)}% brief=${(bench.brevity * 100).toFixed(0)}% novel=${(nov * 100).toFixed(0)}%) | pareto=${pareto.length}`);

    await appendJsonl(EVENTS_PATH, { kind: "gen", gen, fitness, metrics, pareto_size: pareto.length });
    lastGenAt = Date.now();
    gen++;

    // 2) designer (unless we just want to keep running)
    if (gen >= maxGens || (Date.now() - startedAt) / 3_600_000 >= maxHours) break;
    const design = await designerPropose(islandDir, bench, archive, seedSystem, WEIGHTS);
    await writeJson(path.join(genDir, "design.json"), design);
    await appendJsonl(EVENTS_PATH, {
        kind: "design", gen,
        summary: design.summary.slice(0, 400),
        changed: design.changed,
    });
    lastGenAt = Date.now();
}

await writeJson(path.join(SESSION_DIR, "summary.json"), {
    stamp, stop_reason: stopReason, gens: gen,
    elapsed_h: (Date.now() - startedAt) / 3_600_000,
    pareto_size: pareto.length, archive_size: archive.length,
    pareto,
    final_weights: WEIGHTS,
});

console.log("");
console.log(`[continual] STOP (${stopReason}). gens=${gen}, pareto=${pareto.length}, archive=${archive.length}`);
console.log(`[continual] session: ${SESSION_DIR}`);
console.log(`[continual] pareto.json: ${PARETO_PATH}`);
process.exit(0);