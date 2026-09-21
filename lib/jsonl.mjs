// lib/jsonl.mjs — minimal JSONL helpers (read/write append-only).

import { promises as fs } from "node:fs";

export async function readJsonl(path) {
    try {
        const text = await fs.readFile(path, "utf8");
        const out = [];
        for (const line of text.split(/\r?\n/)) {
            const t = line.trim();
            if (!t) continue;
            try {
                out.push(JSON.parse(t));
            } catch {}
        }
        return out;
    } catch (e) {
        if (e.code === "ENOENT") return [];
        throw e;
    }
}

export async function appendJsonl(path, obj) {
    const line = JSON.stringify(obj) + "\n";
    await fs.appendFile(path, line, "utf8");
}

export async function writeJson(path, obj) {
    await fs.writeFile(path, JSON.stringify(obj, null, 2), "utf8");
}