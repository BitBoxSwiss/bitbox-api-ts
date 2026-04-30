// SPDX-License-Identifier: Apache-2.0

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface SimulatorEntry {
  url: string;
  sha256: string;
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function downloadOne(url: string, dest: string): Promise<void> {
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) {
    throw new Error(`download ${url}: HTTP ${resp.status}`);
  }
  const body = Buffer.from(await resp.arrayBuffer());
  await writeFile(dest, body);
}

/**
 * Fetch all simulator binaries listed in `test/simulators.json` into
 * `test/simulators/`, verifying sha256 and skipping anything already
 * cached with the right hash. Returns absolute paths in list order.
 */
export async function downloadSimulators(): Promise<string[]> {
  const jsonPath = path.join(__dirname, 'simulators.json');
  const entries = JSON.parse(await readFile(jsonPath, 'utf8')) as SimulatorEntry[];
  const dir = path.join(__dirname, 'simulators');
  await mkdir(dir, { recursive: true });

  const paths: string[] = [];
  for (const entry of entries) {
    const name = path.basename(new URL(entry.url).pathname);
    const dest = path.join(dir, name);

    let cached = false;
    if (await fileExists(dest)) {
      const actual = await sha256File(dest);
      cached = actual === entry.sha256;
    }
    if (!cached) {
      await downloadOne(entry.url, dest);
      const actual = await sha256File(dest);
      if (actual !== entry.sha256) {
        throw new Error(`sha256 mismatch for ${name}: expected ${entry.sha256}, got ${actual}`);
      }
    }
    await chmod(dest, 0o755);
    paths.push(dest);
  }
  return paths;
}

/**
 * Spawns a simulator binary. Stdio is piped to the parent with an indent
 * prefix for debugging. The transport's own TCP-connect retry loop handles
 * the startup race, so callers just construct and connect.
 * Terminate with `kill()` and `await exited`.
 */
export class SimulatorServer {
  private readonly child: ChildProcess;
  readonly exited: Promise<void>;

  constructor(binaryPath: string) {
    // stdbuf -oL forces line-buffered stdout so our [sim] debug prefix appears
    // promptly — matches the Rust test harness at
    // bitbox-api-rs/tests/util/mod.rs:45-49.
    this.child = spawn('stdbuf', ['-oL', binaryPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.child.stdout?.setEncoding('utf8');
    this.child.stderr?.setEncoding('utf8');
    this.child.stdout?.on('data', (chunk: string) => forward(chunk, process.stdout, '[sim]'));
    this.child.stderr?.on('data', (chunk: string) => forward(chunk, process.stderr, '[sim!]'));
    this.exited = new Promise((resolve) => {
      this.child.once('exit', () => resolve());
    });
  }

  kill(): void {
    if (!this.child.killed && this.child.exitCode === null) {
      this.child.kill('SIGTERM');
    }
  }
}

function forward(chunk: string, out: NodeJS.WritableStream, prefix: string): void {
  for (const line of chunk.split(/\r?\n/)) {
    if (line.length > 0) {
      out.write(`\t\t${prefix} ${line}\n`);
    }
  }
}

export function simulatorSupported(): boolean {
  return process.platform === 'linux' && process.arch === 'x64';
}

export function parseVersionFromFilename(filename: string): string {
  const m = filename.match(/v(\d+\.\d+\.\d+)/);
  if (m === null) {
    throw new Error(`could not extract version from ${filename}`);
  }
  return m[1]!;
}

/**
 * Resolve the simulator binary to run. Honors the `SIMULATOR=/path` env override,
 * otherwise downloads/caches the last entry from `test/simulators.json`.
 */
export async function binaryToRun(): Promise<string> {
  const override = process.env.SIMULATOR;
  if (override !== undefined && override.length > 0) {
    return path.resolve(override);
  }
  const paths = await downloadSimulators();
  const last = paths[paths.length - 1];
  if (last === undefined) {
    throw new Error('no simulators listed in test/simulators.json');
  }
  return last;
}
