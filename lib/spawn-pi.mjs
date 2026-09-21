// lib/spawn-pi.mjs — spawn a `pi` subprocess in --mode rpc and expose a promise API.
//
// Usage:
//   import { PiRpc } from "./lib/spawn-pi.mjs";
//   const pi = new PiRpc({
//     cwd: "D:/合曜AI/rPi/islands/island-0",
//     provider: "minimax-cn",
//     model: "minimax-cn/MiniMax-M2.7",
//     thinking: "off",
//     env: { ...process.env },
//     onEvent: (e) => { ... },
//   });
//   await pi.start();
//   await pi.prompt("Hello");
//   await pi.abort();
//   await pi.dispose();
//
// Protocol: pi --mode rpc uses LF-delimited JSONL on stdin/stdout.
// All commands accept an `id` field; the corresponding response carries the
// same id. Events are streamed as separate JSON objects (no `type:"response"`).
//
// See D:\dev-cache\npm-global\node_modules\@earendil-works\pi-coding-agent\docs\rpc.md
// for the full protocol.

import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import readline from "node:readline";

export class PiRpc {
    constructor(opts = {}) {
        this.cwd = opts.cwd || process.cwd();
        this.provider = opts.provider || "minimax-cn";
        this.model = opts.model || "minimax-cn/MiniMax-M2.7";
        this.thinking = opts.thinking || "off";
        this.env = opts.env || process.env;
        this.tools = opts.tools;             // optional: allowlist, e.g. ["read","write","edit","bash"]
        this.excludeTools = opts.excludeTools;
        this.systemPrompt = opts.systemPrompt; // optional: --system-prompt
        this.appendSystemPrompt = opts.appendSystemPrompt;
        this.noSession = opts.noSession ?? true;
        this.noContextFiles = opts.noContextFiles ?? true;
        this.noExtensions = opts.noExtensions ?? true;
        this.noSkills = opts.noSkills ?? false;
        this.name = opts.name || "rpi-session";
        this.onEvent = opts.onEvent || (() => {});
        this.onLog = opts.onLog || (() => {});

        this.proc = null;
        this.rl = null;
        this._nextReqId = 1;
        this._pending = new Map();   // reqId -> { resolve, reject, timer }
        this._assistantDoneResolvers = [];   // resolved on agent_end
        this._toolExecCount = 0;
        this._assistantText = "";
        this._disposed = false;
    }

    _binPath() {
        // On Windows, .cmd / .bat files cannot be spawned directly; node child_process
        // requires `shell: true` or use the .exe equivalent. We invoke via `node` +
        // the dist bundle path, which avoids the .cmd wrapper and the shell.
        return process.execPath;
    }

    _bundlePath() {
        // The npm-global pi install lives at <npm-global>/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js
        // We let the system `pi` resolution happen on the shell side instead —
        // for headless use we go through `node` + the bundle.
        // We resolve at start() time from PATH/which.
        return null;
    }

    async start() {
        const args = [
            "--mode", "rpc",
            "--provider", this.provider,
            "--model", this.model,
            "--thinking", this.thinking,
            "--name", this.name,
        ];
        if (this.tools === "") {
            args.push("--no-tools");
        } else if (this.tools && this.tools.length) {
            args.push("--tools", this.tools.join(","));
        }
        if (this.excludeTools && this.excludeTools.length) args.push("--exclude-tools", this.excludeTools.join(","));
        if (this.systemPrompt) args.push("--system-prompt", this.systemPrompt);
        if (this.appendSystemPrompt) args.push("--append-system-prompt", this.appendSystemPrompt);
        if (this.noSession) args.push("--no-session");
        // Note: we keep context files ENABLED so an island's AGENTS.md is
        // loaded at startup. Disable per-run only when noContextFiles is true.
        if (this.noContextFiles) args.push("--no-context-files");
        if (this.noExtensions) args.push("--no-extensions");
        if (this.noSkills) args.push("--no-skills");
        // Some flags that improve headless reliability:
        args.push("--approve");              // trust project-local resources for this run
        args.push("--offline");              // no startup network (version check, telemetry)

        // Use the pi.cmd wrapper via shell:true (Node can't directly spawn .cmd/.bat).
        const bin = "pi";
        this.proc = spawn(bin, args, {
            cwd: this.cwd,
            env: this.env,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            shell: process.platform === "win32",  // required on Windows for .cmd resolution
        });

        this.proc.stderr.on("data", (b) => this.onLog("stderr", b.toString()));
        this.proc.on("exit", (code, signal) => {
            this.onLog("exit", `code=${code} signal=${signal}`);
            // reject all pending
            for (const [, p] of this._pending) {
                p.reject(new Error(`pi exited (code=${code} signal=${signal})`));
            }
            this._pending.clear();
        });
        this.proc.on("error", (e) => this.onLog("error", e.message || String(e)));

        this.rl = readline.createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
        this.rl.on("line", (line) => this._onLine(line));

        // Give pi a moment to start.
        await new Promise((r) => setTimeout(r, 200));
    }

    _onLine(line) {
        if (!line) return;
        let msg;
        try {
            msg = JSON.parse(line);
        } catch (e) {
            this.onLog("parse-error", line.slice(0, 200));
            return;
        }

        // Route to event handler and to pending request.
        if (msg && msg.type === "response") {
            const p = this._pending.get(msg.id);
            if (p) {
                this._pending.delete(msg.id);
                clearTimeout(p.timer);
                if (msg.success) p.resolve(msg);
                else p.reject(new Error(`command failed: ${JSON.stringify(msg)}`));
            }
            this.onEvent(msg);
            return;
        }

        // Streaming event
        if (msg && msg.type === "message_update") {
            const inner = msg.assistantMessageEvent;
            if (inner && inner.type === "text_delta") {
                this._assistantText += inner.delta;
            }
        }
        if (msg && msg.type === "tool_execution_start") {
            this._toolExecCount++;
        }
        if (msg && msg.type === "agent_end") {
            const resolvers = this._assistantDoneResolvers;
            this._assistantDoneResolvers = [];
            for (const r of resolvers) r({ text: this._assistantText, toolCount: this._toolExecCount });
        }

        this.onEvent(msg);
    }

    _send(cmd) {
        if (this._disposed) throw new Error("PiRpc disposed");
        const id = `r${this._nextReqId++}`;
        const payload = { ...cmd, id };
        const json = JSON.stringify(payload);
        this.proc.stdin.write(json + "\n");
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new Error(`rpc timeout for ${cmd.type}`));
            }, 300_000);  // 5 min ceiling
            this._pending.set(id, { resolve, reject, timer });
        });
    }

    async prompt(message, opts = {}) {
        this._assistantText = "";
        this._toolExecCount = 0;
        const cmd = { type: "prompt", message };
        if (opts.images) cmd.images = opts.images;
        await this._send(cmd);
        // Wait for the assistant to actually finish.
        const done = new Promise((resolve) => this._assistantDoneResolvers.push(resolve));
        const result = await done;
        return result;
    }

    async abort() {
        try {
            await this._send({ type: "abort" });
        } catch (e) {
            this.onLog("abort-err", e.message || String(e));
        }
    }

    async dispose() {
        if (this._disposed) return;
        this._disposed = true;
        try {
            if (this.proc && !this.proc.killed) {
                this.proc.stdin.end();
                // give it 500ms to flush
                await new Promise((r) => setTimeout(r, 200));
                this.proc.kill();
            }
        } catch {}
        try { this.rl && this.rl.close(); } catch {}
        try { this.proc && this.proc.removeAllListeners(); } catch {}
    }
}