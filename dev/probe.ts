/**
 * Step 1 de-risk probe.
 *
 * Opens the port at 115200, runs the first half of the connection sequence from
 * the spec (Ctrl-C Ctrl-C, 200ms discard window, Ctrl-A), then dumps one second
 * of raw bytes. Nothing here is reused by the IDE; it exists so a human can
 * confirm the device really speaks raw REPL before anything is built on top.
 */

const CTRL_A = 0x01;
const CTRL_C = 0x03;

const connectBtn = document.getElementById('connect') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;
const dumpEl = document.getElementById('dump') as HTMLPreElement;
const decodedEl = document.getElementById('decoded') as HTMLPreElement;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Classic `hexdump -C` style: offset, 16 hex bytes, printable ASCII. */
function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const slice = bytes.subarray(offset, offset + 16);
    const hex: string[] = [];
    let ascii = '';
    for (let i = 0; i < 16; i++) {
      const byte = slice[i];
      if (byte === undefined) {
        hex.push('  ');
      } else {
        hex.push(byte.toString(16).padStart(2, '0'));
        ascii += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.';
      }
      if (i === 7) hex.push('');
    }
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.join(' ')}  |${ascii}|`);
  }
  return lines.join('\n');
}

async function readFor(port: SerialPort, ms: number): Promise<Uint8Array> {
  if (!port.readable) throw new Error('port has no readable stream');
  const reader = port.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = performance.now() + ms;
  try {
    for (;;) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) break;
      const timeout = sleep(remaining).then(() => 'timeout' as const);
      const result = await Promise.race([reader.read(), timeout]);
      if (result === 'timeout') break;
      if (result.done) break;
      if (result.value) {
        chunks.push(result.value);
        total += result.value.length;
      }
    }
  } finally {
    // cancel() unblocks any read still pending inside the race above.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

async function probe(): Promise<void> {
  dumpEl.textContent = '';
  decodedEl.textContent = '';

  let port: SerialPort;
  try {
    port = await navigator.serial.requestPort();
  } catch {
    setStatus('Picker cancelled');
    return;
  }

  setStatus('Opening port...');
  await port.open({
    baudRate: 115200,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    flowControl: 'none',
  });

  try {
    if (!port.writable) throw new Error('port has no writable stream');
    const writer = port.writable.getWriter();
    try {
      setStatus('Sending Ctrl-C Ctrl-C...');
      await writer.write(new Uint8Array([CTRL_C, CTRL_C]));
      await sleep(200);
      setStatus('Sending Ctrl-A...');
      await writer.write(new Uint8Array([CTRL_A]));
    } finally {
      writer.releaseLock();
    }

    setStatus('Reading for 1s...');
    const bytes = await readFor(port, 1000);

    dumpEl.textContent = bytes.length ? hexDump(bytes) : '(no bytes received)';
    decodedEl.textContent = new TextDecoder().decode(bytes);
    setStatus(`Done — ${bytes.length} bytes`);
  } catch (err) {
    setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await port.close().catch(() => {});
  }
}

if (!('serial' in navigator)) {
  connectBtn.disabled = true;
  setStatus('Web Serial unavailable — use Chrome or Edge');
} else {
  connectBtn.addEventListener('click', () => {
    connectBtn.disabled = true;
    void probe().finally(() => {
      connectBtn.disabled = false;
    });
  });
}
