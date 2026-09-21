// diag4.mjs — pin-point why some tasks come back with 0 chars.
// Logs every event for a single task.

import { promises as fs } from "node:fs";
import path from "node:path";
import { PiRpc } from "./lib/spawn-pi.mjs";

const ROOT = process.cwd();
const ISLAND_DIR = path.join(ROOT, "islands", "diag");
await fs.mkdir(ISLAND_DIR, { recursive: true });
await fs.mkdir(path.join(ISLAND_DIR, ".pi"), { recursive: true });

// Use a clean simple system prompt — same as the default.
await fs.writeFile(
    path.join(ISLAND_DIR, ".pi", "SYSTEM.md"),
    "You are a helpful assistant.",
    "utf8",
);
await fs.writeFile(
    path.join(ISLAND_DIR, ".pi", "settings.json"),
    JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }),
    "utf8",
);

// Reuse one of the failing tasks (task 06 — Valid Parentheses).
const taskMd = await fs.readFile(path.join(ROOT, "tasks", "06-valid-parentheses.md"), "utf8");

const pi = new PiRpc({
    cwd: ISLAND_DIR,
    provider: "minimax-cn",
    model: "minimax-cn/MiniMax-M2.7",
    thinking: "off",
    name: "diag4",
    noSkills: true,
    noExtensions: true,
    noContextFiles: true,
    tools: "",
    onLog: (k, msg) => console.error(`[pi:${k}] ${msg}`),
    onEvent: (e) => {
        const t = e?.type ?? "?";
        if (t === "message_update") {
            const inner = e.assistantMessageEvent;
            if (inner?.type === "text_delta") {
                process.stderr.write(`[TEXT] "${inner.delta}"\n`);
            } else if (inner?.type === "thinking_delta") {
                // ignore
            } else {
                process.stderr.write(`[mu:${inner?.type}] ${JSON.stringify(inner).slice(0,150)}\n`);
            }
        } else if (t === "message_end") {
            console.error(`[message_end] role=${e.message?.role} content=${JSON.stringify(e.message?.content)?.slice(0,300)}`);
        } else if (t === "agent_end") {
            console.error(`[agent_end] willRetry=${e.willRetry}`);
        } else if (t === "agent_settled") {
            console.error(`[agent_settled]`);
        }
    },
});

await pi.start();

try {
    const r = await pi.prompt(`Solve:\n\n${taskMd}`);
    console.log("RESULT:", JSON.stringify(r));
} catch (e) {
    console.error("FAIL:", e.message);
}

await pi.dispose();