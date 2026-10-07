// SPDX-License-Identifier: Apache-2.0

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createReadStream, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface SimulatorEntry {
  url: string;
  sha256: string;
}

export interface SimulatorCase {
  name: string;
  version: string;
  binaryPath: string;
}

export type SimulatorScreen =
  | { type: 'confirm'; title: string; body: string }
  | { type: 'transaction_address'; amount: string; address: string }
  | { type: 'transaction_fee'; amount: string; fee: string }
  | { type: 'status'; title: string; body: string }
  | { type: 'swap'; title: string; from: string; to: string };

function screenEndMarker(start: string): string | undefined {
  switch (start) {
    case 'CONFIRM SCREEN START':
      return 'CONFIRM SCREEN END';
    case 'CONFIRM TRANSACTION ADDRESS SCREEN START':
      return 'CONFIRM TRANSACTION ADDRESS SCREEN END';
    case 'CONFIRM TRANSACTION FEE SCREEN START':
      return 'CONFIRM TRANSACTION FEE SCREEN END';
    case 'STATUS SCREEN START':
      return 'STATUS SCREEN END';
    case 'CONFIRM SWAP SCREEN START':
      return 'CONFIRM SWAP SCREEN END';
    default:
      return undefined;
  }
}

function isScreenMarker(line: string): boolean {
  return line.endsWith(' SCREEN START') || line.endsWith(' SCREEN END');
}

function parseScreenFields(
  lines: string[],
  blockLine: number,
  fields: string[],
): string[] {
  const result: string[] = [];
  let lineIndex = 0;
  for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
    const field = fields[fieldIndex]!;
    const line = lines[lineIndex];
    if (line === undefined) {
      throw new Error(`simulator stdout line ${blockLine}: missing ${field} field`);
    }
    const prefix = `${field}: `;
    if (!line.startsWith(prefix)) {
      throw new Error(
        `simulator stdout line ${blockLine}: expected ${JSON.stringify(prefix)}, got ${JSON.stringify(line)}`,
      );
    }
    const valueLines = [line.slice(prefix.length)];
    lineIndex += 1;
    const nextField = fields[fieldIndex + 1];
    if (nextField === undefined) {
      valueLines.push(...lines.slice(lineIndex));
      lineIndex = lines.length;
    } else {
      const nextPrefix = `${nextField}: `;
      while (lineIndex < lines.length && !lines[lineIndex]!.startsWith(nextPrefix)) {
        valueLines.push(lines[lineIndex]!);
        lineIndex += 1;
      }
    }
    result.push(valueLines.join('\n'));
  }
  return result;
}

function parseScreenBlock(
  start: string,
  lines: string[],
  blockLine: number,
): SimulatorScreen {
  switch (start) {
    case 'CONFIRM SCREEN START': {
      const [title, body] = parseScreenFields(lines, blockLine, ['TITLE', 'BODY']);
      return { type: 'confirm', title: title!, body: body! };
    }
    case 'CONFIRM TRANSACTION ADDRESS SCREEN START': {
      const [amount, address] = parseScreenFields(lines, blockLine, ['AMOUNT', 'ADDRESS']);
      return { type: 'transaction_address', amount: amount!, address: address! };
    }
    case 'CONFIRM TRANSACTION FEE SCREEN START': {
      const [amount, fee] = parseScreenFields(lines, blockLine, ['AMOUNT', 'FEE']);
      return { type: 'transaction_fee', amount: amount!, fee: fee! };
    }
    case 'STATUS SCREEN START': {
      const titleLine = lines[0];
      if (titleLine === undefined || !titleLine.startsWith('TITLE: ')) {
        throw new Error(`simulator stdout line ${blockLine}: missing TITLE field`);
      }
      return {
        type: 'status',
        title: titleLine.slice('TITLE: '.length),
        body: lines.slice(1).join('\n'),
      };
    }
    case 'CONFIRM SWAP SCREEN START': {
      const [title, from, to] = parseScreenFields(
        lines,
        blockLine,
        ['TITLE', 'FROM', 'TO'],
      );
      return { type: 'swap', title: title!, from: from!, to: to! };
    }
    default:
      throw new Error(`simulator stdout line ${blockLine}: unknown screen marker ${start}`);
  }
}

export function parseSimulatorScreens(output: string): SimulatorScreen[] {
  const lines = output.split(/\r?\n/);
  if (lines.at(-1) === '') {
    lines.pop();
  }
  const result: SimulatorScreen[] = [];
  let index = 0;
  while (index < lines.length) {
    const start = lines[index]!;
    const endMarker = screenEndMarker(start);
    if (endMarker === undefined) {
      if (isScreenMarker(start)) {
        throw new Error(
          `simulator stdout line ${index + 1}: unknown screen marker ${JSON.stringify(start)}`,
        );
      }
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < lines.length && lines[end] !== endMarker) {
      if (screenEndMarker(lines[end]!) !== undefined) {
        throw new Error(
          `simulator stdout line ${end + 1}: screen starting on line ${index + 1} contains a nested screen`,
        );
      }
      if (isScreenMarker(lines[end]!)) {
        throw new Error(
          `simulator stdout line ${end + 1}: unexpected marker ${JSON.stringify(lines[end])}`,
        );
      }
      end += 1;
    }
    if (end === lines.length) {
      throw new Error(`simulator stdout line ${index + 1}: missing ${endMarker}`);
    }
    result.push(parseScreenBlock(start, lines.slice(index + 1, end), index + 1));
    index = end + 1;
  }
  return result;
}

export class SimulatorStdoutSnapshot {
  constructor(private readonly lines: string[]) {}

  raw(): string {
    return this.lines.length === 0 ? '' : `${this.lines.join('\n')}\n`;
  }

  screens(): SimulatorScreen[] {
    return parseSimulatorScreens(this.raw());
  }
}

export class SimulatorStdout {
  private readonly lines: string[] = [];
  private lastUpdate = Date.now();
  private closed = false;

  recordLine(line: string): void {
    this.lines.push(line);
    this.lastUpdate = Date.now();
  }

  markClosed(): void {
    this.closed = true;
  }

  checkpoint(): number {
    return this.lines.length;
  }

  snapshot(checkpoint: number): SimulatorStdoutSnapshot {
    if (checkpoint > this.lines.length) {
      throw new Error('simulator stdout checkpoint is out of bounds');
    }
    return new SimulatorStdoutSnapshot(this.lines.slice(checkpoint));
  }

  async waitUntilStable(
    checkpoint: number,
    stableForMs = 50,
    timeoutMs = 5_000,
  ): Promise<SimulatorStdoutSnapshot> {
    const started = Date.now();
    for (;;) {
      const now = Date.now();
      const lastUpdate = this.lines.length > checkpoint ? this.lastUpdate : started;
      if (now - lastUpdate >= stableForMs || this.closed) {
        return this.snapshot(checkpoint);
      }
      if (now - started >= timeoutMs) {
        const snapshot = this.snapshot(checkpoint);
        throw new Error(`waiting for stable simulator stdout timed out\n${snapshot.raw()}`);
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  async waitForTerminalScreen(
    checkpoint: number,
    timeoutMs = 5_000,
  ): Promise<SimulatorStdoutSnapshot> {
    const started = Date.now();
    for (;;) {
      const snapshot = this.snapshot(checkpoint);
      try {
        if (snapshot.screens().at(-1)?.type === 'status') {
          return snapshot;
        }
      } catch {
        // A screen block may still be arriving; parse again after the next poll.
      }
      if (this.closed) {
        throw new Error(`simulator stdout closed before terminal screen\n${snapshot.raw()}`);
      }
      if (Date.now() - started >= timeoutMs) {
        throw new Error(`waiting for terminal simulator screen timed out\n${snapshot.raw()}`);
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}

function simulatorsJsonPath(): string {
  return path.join(__dirname, 'simulators.json');
}

function simulatorsDir(): string {
  return path.join(__dirname, 'simulators');
}

function parseSimulatorEntries(raw: string): SimulatorEntry[] {
  const entries = JSON.parse(raw) as SimulatorEntry[];
  if (!Array.isArray(entries)) {
    throw new Error('test/simulators.json must contain an array');
  }
  return entries;
}

function binaryNameFromUrl(url: string): string {
  return path.basename(new URL(url).pathname);
}

function binaryPathForEntry(entry: SimulatorEntry): string {
  return path.join(simulatorsDir(), binaryNameFromUrl(entry.url));
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
  const entries = parseSimulatorEntries(await readFile(simulatorsJsonPath(), 'utf8'));
  const dir = simulatorsDir();
  await mkdir(dir, { recursive: true });

  const paths: string[] = [];
  for (const entry of entries) {
    const name = binaryNameFromUrl(entry.url);
    const dest = binaryPathForEntry(entry);

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

let downloadedSimulators: Promise<Set<string>> | undefined;

async function downloadedSimulatorPaths(): Promise<Set<string>> {
  const paths = await downloadSimulators();
  return new Set(paths);
}

/**
 * Return the simulator matrix without downloading binaries. Each case maps one
 * manifest entry to its expected on-disk path and parsed firmware version.
 */
export function simulatorCases(): SimulatorCase[] {
  const override = process.env.SIMULATOR;
  if (override !== undefined && override.length > 0) {
    const binaryPath = path.resolve(override);
    const version = parseVersionFromFilename(path.basename(binaryPath));
    return [{ name: version, version, binaryPath }];
  }

  const entries = parseSimulatorEntries(readFileSync(simulatorsJsonPath(), 'utf8'));
  return entries.map((entry) => {
    const binaryPath = binaryPathForEntry(entry);
    const version = parseVersionFromFilename(path.basename(binaryPath));
    return { name: version, version, binaryPath };
  });
}

/**
 * Ensure a simulator case is present and hash-verified before it is launched.
 * Downloads the full manifest once per test worker so manifest/hash issues fail
 * before any matrix case can silently use stale binaries.
 */
export async function ensureSimulator(simulator: SimulatorCase): Promise<string> {
  const override = process.env.SIMULATOR;
  if (override !== undefined && override.length > 0) {
    return simulator.binaryPath;
  }

  downloadedSimulators ??= downloadedSimulatorPaths();
  const paths = await downloadedSimulators;
  if (!paths.has(simulator.binaryPath)) {
    throw new Error(`simulator not found in downloaded manifest: ${simulator.binaryPath}`);
  }
  return simulator.binaryPath;
}

/**
 * Spawns a simulator binary. Stdio is piped to the parent with an indent
 * prefix for debugging. The transport's own TCP-connect retry loop handles
 * the startup race, so callers just construct and connect.
 * Terminate with `kill()` and `await exited`.
 */
export class SimulatorServer {
  private readonly child: ChildProcess;
  readonly stdout = new SimulatorStdout();
  readonly exited: Promise<void>;

  constructor(binaryPath: string) {
    // stdbuf -oL forces line-buffered stdout so our [sim] debug prefix appears
    // promptly — matches the Rust test harness at
    // bitbox-api-rs/tests/util/mod.rs:45-49.
    this.child = spawn('stdbuf', ['-oL', binaryPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.child.stdout?.setEncoding('utf8');
    this.child.stderr?.setEncoding('utf8');
    const stdoutLines = new LineForwarder(process.stdout, '[sim]', (line) => {
      this.stdout.recordLine(line);
    });
    const stderrLines = new LineForwarder(process.stderr, '[sim!]');
    this.child.stdout?.on('data', (chunk: string) => stdoutLines.write(chunk));
    this.child.stderr?.on('data', (chunk: string) => stderrLines.write(chunk));
    this.child.stdout?.on('end', () => {
      stdoutLines.end();
      this.stdout.markClosed();
    });
    this.child.stderr?.on('end', () => stderrLines.end());
    this.exited = new Promise((resolve) => {
      this.child.once('exit', () => resolve());
    });
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (this.child.exitCode === null) {
      this.child.kill(signal);
    }
  }

  async stop(timeoutMs = 5_000): Promise<void> {
    this.kill();

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      this.exited.then(() => false),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => { resolve(true); }, timeoutMs);
      }),
    ]);
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (timedOut && this.child.exitCode === null) {
      this.kill('SIGKILL');
      await this.exited;
    }
  }
}

class LineForwarder {
  private remainder = '';

  constructor(
    private readonly out: NodeJS.WritableStream,
    private readonly prefix: string,
    private readonly onLine?: (line: string) => void,
  ) {}

  write(chunk: string): void {
    const lines = `${this.remainder}${chunk}`.split(/\r?\n/);
    this.remainder = lines.pop() ?? '';
    for (const line of lines) {
      this.forward(line);
    }
  }

  end(): void {
    if (this.remainder.length > 0) {
      this.forward(this.remainder);
      this.remainder = '';
    }
  }

  private forward(line: string): void {
    this.onLine?.(line);
    if (line.length > 0 && process.env.UPDATE_BTC_VECTOR_SCREENS !== '1') {
      this.out.write(`\t\t${this.prefix} ${line}\n`);
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
