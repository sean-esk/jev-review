// Filesystem store for local-model write-ups. Sits beside the review report.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Writeup } from "../domain/types.ts";
import { findingKey } from "../domain/writeup.ts";
import { reportPath } from "./report-store.ts";

export type StoredWriteups = {
  writeups: Writeup[];
};

export function writeupPath(report = reportPath()): string {
  return resolve(dirname(report), "writeups.json");
}

export async function readWriteups(path = writeupPath()): Promise<Writeup[]> {
  try {
    const text = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const rows = (parsed as StoredWriteups).writeups;
    return Array.isArray(rows) ? rows.filter(isWriteup) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [];
  }
}

export async function upsertWriteup(writeup: Writeup, path = writeupPath()): Promise<Writeup[]> {
  const current = await readWriteups(path);
  const next = [...current.filter((entry) => entry.key !== writeup.key), writeup];
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ writeups: next }, null, 2)}\n`);
  await rename(temp, path);
  return next;
}

function isWriteup(value: unknown): value is Writeup {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<Writeup>;
  return typeof row.key === "string" && typeof row.claim === "string" && row.key === findingKey(row as Writeup);
}
