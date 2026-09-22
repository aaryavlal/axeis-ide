/**
 * Entry point: wires the modules to the DOM. All cross-module policy
 * (what to log, when to change state) lives here; the modules themselves
 * stay unaware of each other.
 */

import { ConsolePanel } from './console.ts';
import { createEditor, DEFAULT_PROGRAM } from './editor.ts';
import { downloadPython, hashContents, pickPythonFile } from './files.ts';
import { Repl, ReplConnectionLostError } from './repl.ts';
import {
  describePort,
  isWebSerialSupported,
  onSerialDisconnect,
  openPort,
  PortPermissionDenied,
  PortPickerCancelled,
  requestPort,
} from './serial.ts';
import { Ui } from './ui.ts';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const appEl = byId<HTMLDivElement>('app');
const unsupportedEl = byId<HTMLDivElement>('unsupported');

// Spec 8.1: no Web Serial, no IDE. Bail before anything else is constructed.
if (!isWebSerialSupported()) {
  appEl.hidden = true;
  unsupportedEl.hidden = false;
  for (const button of appEl.querySelectorAll('button')) {
    button.disabled = true;
  }
} else {
  start();
}

function start(): void {
  const consolePanel = new ConsolePanel(byId('console'), byId('console-notice'));
  const editor = createEditor(byId('editor'), { onRun: () => void handleRun() });
  const fileInput = byId<HTMLInputElement>('file-input');
  const repl = new Repl();

  const ui = new Ui({
    connect: byId<HTMLButtonElement>('connect'),
    run: byId<HTMLButtonElement>('run'),
    stop: byId<HTMLButtonElement>('stop'),
    download: byId<HTMLButtonElement>('download'),
    upload: byId<HTMLButtonElement>('upload'),
    clear: byId<HTMLButtonElement>('clear'),
    status: byId('status'),
    statusText: byId('status-text'),
  });

  /** Hash of the contents as last saved or loaded; drives the unsaved check. */
  let savedHash = hashContents(DEFAULT_PROGRAM);
  let activePort: SerialPort | null = null;
  /** Suppresses "connection lost" noise when the user asked to disconnect. */
  let closingOnPurpose = false;
  /** True for the whole run, so an unplug is described correctly (spec 8.6). */
  let running = false;

  consolePanel.writeLine('system', 'AXEIS IDE ready. Plug in the robot and click Connect.');

  async function handleConnect(): Promise<void> {
    if (activePort) {
      await handleDisconnect();
      return;
    }

    let port: SerialPort;
    try {
      port = await requestPort();
    } catch (err) {
      if (err instanceof PortPickerCancelled) return; // spec 8.2: silent
      if (err instanceof PortPermissionDenied) {
        consolePanel.writeLine('system', 'Permission required to connect');
        return;
      }
      consolePanel.writeLine('system', `Could not list serial ports: ${message(err)}`);
      return;
    }

    ui.set('connecting');
    try {
      await openPort(port);
    } catch (err) {
      consolePanel.writeLine('system', `Could not open the serial port: ${message(err)}`);
      ui.set('error', message(err));
      return;
    }

    try {
      await repl.connect(port);
    } catch (err) {
      await port.close().catch(() => undefined);
      consolePanel.writeLine('system', message(err));
      ui.set('error', message(err));
      return;
    }

    activePort = port;
    const info = describePort(port);
    ui.setDeviceInfo(info);
    ui.set('connected');
    consolePanel.writeLine('system', `Connected${info ? ` (${info})` : ''} — raw REPL ready.`);
    editor.focus();
  }

  async function handleDisconnect(): Promise<void> {
    closingOnPurpose = true;
    try {
      await repl.disconnect(true);
    } finally {
      closingOnPurpose = false;
    }
    activePort = null;
    ui.setDeviceInfo('');
    ui.set('disconnected');
    consolePanel.writeLine('system', 'Disconnected — device left in the friendly REPL.');
  }

  /** Unexpected loss of the port, from either the OS event or a failed read. */
  function handleConnectionLost(reason: string): void {
    if (!activePort) return; // already torn down by whichever path got here first
    activePort = null;
    void repl.disconnect(false);
    consolePanel.writeLine('system', reason);
    ui.setDeviceInfo('');
    ui.set('disconnected');
  }

  async function handleRun(): Promise<void> {
    // Spec 8.8: the button state makes this unreachable, but never trust it.
    if (!repl.isConnected() || repl.isBusy()) return;

    const code = editor.getValue();
    ui.set('executing');
    consolePanel.writeLine('action', '▶ Running...');

    running = true;
    try {
      for await (const chunk of repl.execute(code)) {
        consolePanel.write(chunk.stream, chunk.data);
      }
      ui.set('connected');
    } catch (err) {
      if (closingOnPurpose) return;
      if (err instanceof ReplConnectionLostError) {
        handleConnectionLost('Connection lost during execution');
        return;
      }
      // Something went wrong mid-protocol (e.g. the device stopped answering).
      // The board may be mid-frame, so nudge it back to a known prompt before
      // letting the user press Run again.
      consolePanel.writeLine('system', `Run failed: ${message(err)}`);
      await repl.interrupt().catch(() => undefined);
      ui.set(repl.isConnected() ? 'connected' : 'disconnected');
    } finally {
      running = false;
    }
  }

  async function handleStop(): Promise<void> {
    if (!repl.isBusy()) return;
    consolePanel.write('stderr', '^C\n');
    try {
      await repl.interrupt();
    } catch (err) {
      if (err instanceof ReplConnectionLostError) {
        handleConnectionLost('Connection lost');
        return;
      }
      consolePanel.writeLine('system', `Could not interrupt: ${message(err)}`);
    }
  }

  function handleDownload(): void {
    const contents = editor.getValue();
    const filename = downloadPython(contents);
    if (filename === null) return; // spec 6.5: cancelled prompt is a no-op
    savedHash = hashContents(contents);
    consolePanel.writeLine('system', `Saved ${filename}`);
  }

  async function handleUpload(): Promise<void> {
    let file;
    try {
      file = await pickPythonFile(fileInput);
    } catch (err) {
      consolePanel.writeLine('system', `Could not read that file: ${message(err)}`);
      return;
    }
    if (!file) return;

    const dirty = hashContents(editor.getValue()) !== savedHash;
    if (dirty && !window.confirm('Replace current editor contents? Unsaved changes will be lost.')) {
      return;
    }

    editor.setValue(file.text);
    savedHash = hashContents(file.text);
    // Spec 6.6 / section 11: loading a file never runs it.
    consolePanel.writeLine('system', `Loaded ${file.name} — press Run to execute it.`);
    editor.focus();
  }

  byId<HTMLButtonElement>('connect').addEventListener('click', () => void handleConnect());
  byId<HTMLButtonElement>('run').addEventListener('click', () => void handleRun());
  byId<HTMLButtonElement>('stop').addEventListener('click', () => void handleStop());
  byId<HTMLButtonElement>('download').addEventListener('click', handleDownload);
  byId<HTMLButtonElement>('upload').addEventListener('click', () => void handleUpload());
  byId<HTMLButtonElement>('clear').addEventListener('click', () => consolePanel.clear());

  // Spec 6.8: never auto-reconnect, just report and reset.
  onSerialDisconnect((port) => {
    if (port !== activePort) return;
    handleConnectionLost(running ? 'Connection lost during execution' : 'Robot disconnected');
  });

  // Leave no zombie port behind on refresh.
  window.addEventListener('pagehide', () => {
    if (activePort) void repl.disconnect(false);
  });
}
