/**
 * Step 2 manual harness for repl.ts.
 *
 * Not part of the IDE and not part of the production build — Vite only bundles
 * index.html. Reach it in dev at /dev/repl-test.html.
 */

import { Repl } from '../src/repl.ts';
import { openPort, requestPort, PortPickerCancelled } from '../src/serial.ts';

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const connectBtn = byId<HTMLButtonElement>('connect');
const disconnectBtn = byId<HTMLButtonElement>('disconnect');
const interruptBtn = byId<HTMLButtonElement>('interrupt');
const statusEl = byId<HTMLSpanElement>('status');
const logEl = byId<HTMLPreElement>('log');

const snippets: Record<string, string> = {
  'run-hello': 'print("hello from AXEIS")\nprint(2 + 2)',
  'run-count': 'import time\nfor i in range(200):\n    print(i)\n    time.sleep(0.1)',
  'run-error': '1 / 0',
  'run-syntax': 'print(',
};

const repl = new Repl();
let started = 0;

function log(line: string): void {
  logEl.textContent += `${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function stamp(): string {
  return `${String(Math.round(performance.now() - started)).padStart(6)}ms`;
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function setRunButtons(enabled: boolean): void {
  for (const id of Object.keys(snippets)) {
    byId<HTMLButtonElement>(id).disabled = !enabled;
  }
}

async function connect(): Promise<void> {
  let port: SerialPort;
  try {
    port = await requestPort();
  } catch (err) {
    if (err instanceof PortPickerCancelled) return;
    log(`picker error: ${String(err)}`);
    return;
  }
  setStatus('connecting...');
  try {
    await openPort(port);
    await repl.connect(port);
  } catch (err) {
    setStatus('failed');
    log(`connect failed: ${err instanceof Error ? err.message : String(err)}`);
    await port.close().catch(() => undefined);
    return;
  }
  setStatus('connected');
  log('-- connected, at raw REPL prompt --');
  connectBtn.disabled = true;
  disconnectBtn.disabled = false;
  setRunButtons(true);
}

async function run(code: string): Promise<void> {
  started = performance.now();
  log(`\n>>> ${JSON.stringify(code)}`);
  setRunButtons(false);
  interruptBtn.disabled = false;
  setStatus('running');
  try {
    for await (const chunk of repl.execute(code)) {
      log(`${stamp()} ${chunk.stream.padEnd(6)} ${JSON.stringify(chunk.data)}`);
    }
    log(`${stamp()} -- done, back at prompt --`);
    setStatus('connected');
  } catch (err) {
    log(`${stamp()} !! ${err instanceof Error ? err.message : String(err)}`);
    setStatus('error');
  } finally {
    interruptBtn.disabled = true;
    setRunButtons(repl.isConnected());
    if (!repl.isConnected()) {
      disconnectBtn.disabled = true;
      connectBtn.disabled = false;
    }
  }
}

connectBtn.addEventListener('click', () => void connect());

disconnectBtn.addEventListener('click', () => {
  void repl.disconnect().then(() => {
    log('-- disconnected (Ctrl-B sent, port closed) --');
    setStatus('idle');
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    setRunButtons(false);
  });
});

interruptBtn.addEventListener('click', () => {
  log(`${stamp()} -- sending Ctrl-C --`);
  void repl.interrupt();
});

for (const [id, code] of Object.entries(snippets)) {
  byId<HTMLButtonElement>(id).addEventListener('click', () => void run(code));
}

if (!('serial' in navigator)) {
  connectBtn.disabled = true;
  setStatus('Web Serial unavailable — use Chrome or Edge');
}
