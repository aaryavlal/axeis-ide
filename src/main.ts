/**
 * Entry point: wires the modules to the DOM. All cross-module policy
 * (what to log, when to change state) lives here; the modules themselves
 * stay unaware of each other.
 */

import { createBlockEditor } from './blockspace.ts';
import { ConsolePanel } from './console.ts';
import { createEditor, DEFAULT_PROGRAM } from './editor.ts';
import { downloadBlocks, downloadPython, hashContents, isBlocksFile, pickFile } from './files.ts';
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
  const blocks = createBlockEditor(byId('blocks'));
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
  let savedBlocksHash = hashContents(JSON.stringify(blocks.save()));
  /** Block mode is the default; Run, Download and Upload follow the open tab. */
  let mode: 'blocks' | 'python' = 'blocks';
  let activePort: SerialPort | null = null;
  /** Suppresses "connection lost" noise when the user asked to disconnect. */
  let closingOnPurpose = false;
  /** True for the whole run, so an unplug is described correctly (spec 8.6). */
  let running = false;

  consolePanel.writeLine('system', 'AXEIS IDE ready. Plug in the robot and click Connect.');

  const consolePane = byId('console-pane');
  const consoleToggle = byId<HTMLButtonElement>('console-toggle');
  const consoleBody = byId('console-body');
  const consoleUnread = byId('console-unread');

  function setConsoleOpen(open: boolean): void {
    consolePane.dataset['open'] = String(open);
    consoleToggle.setAttribute('aria-expanded', String(open));
    consoleBody.hidden = !open;
    if (open) {
      consoleUnread.hidden = true;
      consolePanel.scrollToEnd();
    }
  }

  // Program output while the drawer is shut gets a badge; status chatter does not.
  consolePanel.onOutput = (stream) => {
    if (consoleBody.hidden && stream !== 'system') consoleUnread.hidden = false;
  };

  const tabBlocks = byId<HTMLButtonElement>('tab-blocks');
  const tabPython = byId<HTMLButtonElement>('tab-python');
  const toPython = byId<HTMLButtonElement>('to-python');

  function setMode(next: 'blocks' | 'python'): void {
    mode = next;
    const isBlocks = next === 'blocks';
    tabBlocks.setAttribute('aria-selected', String(isBlocks));
    tabPython.setAttribute('aria-selected', String(!isBlocks));
    byId('blocks').hidden = !isBlocks;
    byId('editor').hidden = isBlocks;
    toPython.hidden = !isBlocks;
    if (isBlocks) blocks.resize();
    else editor.focus();
  }

  function pythonIsDirty(): boolean {
    return hashContents(editor.getValue()) !== savedHash;
  }

  function handleOpenAsPython(): void {
    if (pythonIsDirty() && !window.confirm('Replace the Python tab? Unsaved changes there will be lost.')) {
      return;
    }
    editor.setValue(blocks.getProgram().code);
    setMode('python');
    consolePanel.writeLine('system', 'Copied the Python made by your blocks into the Python tab.');
  }

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

    let code: string;
    if (mode === 'blocks') {
      const program = blocks.getProgram();
      if (!program.hasStart) {
        setConsoleOpen(true);
        consolePanel.writeLine(
          'system',
          'Nothing to run: drag "when Run clicked" from Events and snap blocks under it.',
        );
        return;
      }
      code = program.code;
    } else {
      code = editor.getValue();
    }
    setConsoleOpen(true);
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
    if (mode === 'blocks') {
      const state = blocks.save();
      const filename = downloadBlocks(state);
      if (filename === null) return;
      savedBlocksHash = hashContents(JSON.stringify(state));
      consolePanel.writeLine('system', `Saved ${filename}`);
      return;
    }
    const contents = editor.getValue();
    const filename = downloadPython(contents);
    if (filename === null) return; // spec 6.5: cancelled prompt is a no-op
    savedHash = hashContents(contents);
    consolePanel.writeLine('system', `Saved ${filename}`);
  }

  async function handleUpload(): Promise<void> {
    let file;
    try {
      file = await pickFile(fileInput);
    } catch (err) {
      consolePanel.writeLine('system', `Could not read that file: ${message(err)}`);
      return;
    }
    if (!file) return;

    if (isBlocksFile(file.name)) {
      let state: object;
      try {
        state = JSON.parse(file.text) as object;
      } catch {
        consolePanel.writeLine('system', `${file.name} is not a block program.`);
        return;
      }
      const dirty = hashContents(JSON.stringify(blocks.save())) !== savedBlocksHash;
      if (dirty && !window.confirm('Replace your blocks? Unsaved changes will be lost.')) return;
      setMode('blocks');
      try {
        blocks.load(state);
      } catch (err) {
        consolePanel.writeLine('system', `${file.name} is not a block program: ${message(err)}`);
        return;
      }
      savedBlocksHash = hashContents(JSON.stringify(blocks.save()));
      consolePanel.writeLine('system', `Loaded ${file.name} — press Run to execute it.`);
      return;
    }

    if (pythonIsDirty() && !window.confirm('Replace current editor contents? Unsaved changes will be lost.')) {
      return;
    }

    editor.setValue(file.text);
    savedHash = hashContents(file.text);
    setMode('python');
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
  tabBlocks.addEventListener('click', () => setMode('blocks'));
  tabPython.addEventListener('click', () => setMode('python'));
  toPython.addEventListener('click', handleOpenAsPython);
  consoleToggle.addEventListener('click', () => setConsoleOpen(consoleBody.hidden));

  // Ctrl-Enter / Cmd-Enter runs in block mode too (the Python editor handles its own).
  document.addEventListener('keydown', (event) => {
    if (mode !== 'blocks' || event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    void handleRun();
  });

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
