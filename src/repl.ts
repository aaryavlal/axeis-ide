/**
 * MicroPython raw REPL over Web Serial.
 *
 * This is the only module that knows about MicroPython control bytes.
 *
 * Raw REPL (Ctrl-A), not paste mode: the device frames every response the same
 * way, so code submission and output can be parsed without guessing.
 *
 *   submit:   <code bytes> 0x04
 *   response: "OK" <stdout> 0x04 <stderr> 0x04 ">"
 *
 * Output is streamed to the caller as bytes arrive. A program that prints for
 * ten minutes shows output for ten minutes; nothing is buffered to the end.
 */

const CTRL_A = 0x01;
const CTRL_B = 0x02;
const CTRL_C = 0x03;
const CTRL_D = 0x04;

/** Both the "execute this" byte we send and the EOF marker the device sends. */
const EOF = CTRL_D;

const RAW_PROMPT_BANNER = 'raw REPL; CTRL-B to exit\r\n>';
const PROMPT = '>';

/** Bootloader chatter / leftover prompt noise right after the port opens. */
const DISCARD_WINDOW_MS = 200;
/** Gap between the two Ctrl-Cs; the first often lands while the board is still booting. */
const INTERRUPT_GAP_MS = 100;
/** Spec section 8.4: how long we wait for proof this device speaks MicroPython. */
const RAW_PROMPT_TIMEOUT_MS = 2500;
/** A board reset by port open can still be booting on the first probe. */
const PROBE_ATTEMPTS = 2;
/** The device acknowledges a submission immediately or not at all. */
const ACK_TIMEOUT_MS = 2000;
/** Trailing '>' after a run has already finished; only lateness is an error. */
const PROMPT_TIMEOUT_MS = 2000;

const encoder = new TextEncoder();

export type OutputStream = 'stdout' | 'stderr';

export interface OutputChunk {
  stream: OutputStream;
  data: string;
}

export class ReplError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplError';
  }
}

export class ReplTimeoutError extends ReplError {
  constructor(message: string) {
    super(message);
    this.name = 'ReplTimeoutError';
  }
}

/** The port died under us: cable pulled, board reset, stream aborted. */
export class ReplConnectionLostError extends ReplError {
  constructor(message = 'Connection lost') {
    super(message);
    this.name = 'ReplConnectionLostError';
  }
}

/**
 * Terminal output uses \r\n. Stripping every \r is equivalent to \r\n -> \n for
 * our purposes and, unlike a two-character replace, is safe when a chunk
 * boundary falls between the \r and the \n.
 */
function normalizeNewlines(text: string): string {
  return text.replace(/\r/g, '');
}

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Hex plus escaped text, so a console dump shows exactly what the board sent. */
function describeBytes(chunks: Uint8Array[]): string {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  const hex = Array.from(all, (b) => b.toString(16).padStart(2, '0')).join(' ');
  const text = Array.from(all, (b) =>
    b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`,
  ).join('');
  return `${total} bytes\n  hex:  ${hex}\n  text: ${text}`;
}

/** Byte queue with the few operations the protocol parser needs. */
class ByteBuffer {
  private data = new Uint8Array(0);

  get length(): number {
    return this.data.length;
  }

  append(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    const merged = new Uint8Array(this.data.length + chunk.length);
    merged.set(this.data, 0);
    merged.set(chunk, this.data.length);
    this.data = merged;
  }

  indexOfByte(byte: number, from = 0): number {
    return this.data.indexOf(byte, from);
  }

  indexOf(needle: Uint8Array, from = 0): number {
    if (needle.length === 0) return from;
    const first = needle[0] as number;
    const last = this.data.length - needle.length;
    for (let start = Math.max(0, from); start <= last; start++) {
      if (this.data[start] !== first) continue;
      let matched = true;
      for (let i = 1; i < needle.length; i++) {
        if (this.data[start + i] !== needle[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return start;
    }
    return -1;
  }

  /** Remove and return the first n bytes (fewer if the buffer is shorter). */
  take(n: number): Uint8Array {
    const count = Math.min(n, this.data.length);
    const head = this.data.slice(0, count);
    this.data = this.data.subarray(count);
    return head;
  }

  takeAll(): Uint8Array {
    return this.take(this.data.length);
  }

  clear(): void {
    this.data = new Uint8Array(0);
  }
}

/**
 * Owns the port's reader and writer for the life of a connection.
 *
 * One read loop fills a buffer; the protocol code above pulls framed pieces out
 * of it. Writes go through a promise chain so two of them can never interleave
 * on the wire (spec section 8.9).
 *
 * Only one consumer may read at a time. The Repl state machine guarantees that:
 * connect, execute, interrupt and disconnect never overlap.
 */
class PortChannel {
  private readonly buffer = new ByteBuffer();
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private pump: Promise<void> | null = null;
  private writeChain: Promise<unknown> = Promise.resolve();
  private wake: (() => void) | null = null;
  private failure: Error | null = null;
  private ended = false;
  /** Copy of every received chunk while non-null; used to log the connect handshake. */
  private capture: Uint8Array[] | null = null;

  constructor(private readonly port: SerialPort) {}

  start(): void {
    const { readable, writable } = this.port;
    if (!readable || !writable) {
      throw new ReplError('Serial port is not open for reading and writing');
    }
    this.reader = readable.getReader();
    this.writer = writable.getWriter();
    this.pump = this.readLoop(this.reader);
  }

  private async readLoop(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          this.capture?.push(value.slice());
          this.buffer.append(value);
          this.notify();
        }
      }
    } catch (err) {
      this.failure = new ReplConnectionLostError(
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      this.ended = true;
      this.notify();
    }
  }

  startCapture(): void {
    this.capture = [];
  }

  /** Stop recording and return everything received since startCapture(). */
  endCapture(): Uint8Array[] {
    const captured = this.capture ?? [];
    this.capture = null;
    return captured;
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    if (wake) wake();
  }

  write(payload: Uint8Array): Promise<void> {
    const attempt = this.writeChain.then(async () => {
      const writer = this.writer;
      if (!writer) throw new ReplConnectionLostError('Serial port is closed');
      await writer.write(payload);
    });
    // Keep the queue usable after a failed write; the caller still sees the error.
    this.writeChain = attempt.catch(() => undefined);
    return attempt;
  }

  /**
   * Resolve once *new* bytes arrive. `timeoutMs` null waits indefinitely.
   *
   * Never returns early just because the buffer is non-empty: callers only get
   * here when what is buffered is not enough, and returning immediately would
   * spin them in a microtask loop that starves the read pump and freezes the tab.
   */
  private async waitForData(timeoutMs: number | null): Promise<void> {
    this.throwIfDead();
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      this.wake = () => {
        if (timer !== null) clearTimeout(timer);
        resolve();
      };
      if (timeoutMs !== null) {
        timer = setTimeout(() => {
          this.wake = null;
          reject(new ReplTimeoutError('Timed out waiting for the device'));
        }, timeoutMs);
      }
    });
    if (this.buffer.length === 0) this.throwIfDead();
  }

  private throwIfDead(): void {
    if (this.failure) throw this.failure;
    if (this.ended) throw new ReplConnectionLostError('Serial connection closed');
  }

  async readExactly(count: number, timeoutMs: number | null): Promise<Uint8Array> {
    while (this.buffer.length < count) {
      await this.waitForData(timeoutMs);
    }
    return this.buffer.take(count);
  }

  /** Read up to `needle`, consuming it. Returns everything before it. */
  async readUntil(needle: Uint8Array, timeoutMs: number | null): Promise<Uint8Array> {
    let searchFrom = 0;
    for (;;) {
      const at = this.buffer.indexOf(needle, searchFrom);
      if (at >= 0) {
        const head = this.buffer.take(at);
        this.buffer.take(needle.length);
        return head;
      }
      // A partial match may straddle the next chunk, so back off by needle-1.
      searchFrom = Math.max(0, this.buffer.length - needle.length + 1);
      await this.waitForData(timeoutMs);
    }
  }

  /**
   * Yield bytes as they arrive until `byte` shows up, consuming the marker.
   * This is what makes long-running output visible in real time.
   */
  async *streamUntilByte(byte: number, timeoutMs: number | null): AsyncGenerator<Uint8Array> {
    for (;;) {
      const at = this.buffer.indexOfByte(byte);
      if (at >= 0) {
        const head = this.buffer.take(at);
        this.buffer.take(1);
        if (head.length > 0) yield head;
        return;
      }
      if (this.buffer.length > 0) {
        yield this.buffer.takeAll();
        continue;
      }
      await this.waitForData(timeoutMs);
    }
  }

  /** Throw away everything that arrives in the next `ms` (spec section 8.5). */
  async discardFor(ms: number): Promise<void> {
    // performance.now() is monotonic; a wall-clock resync mid-window must not
    // stretch or collapse the discard.
    const deadline = performance.now() + ms;
    for (;;) {
      this.buffer.clear();
      const remaining = deadline - performance.now();
      if (remaining <= 0) break;
      try {
        await this.waitForData(remaining);
      } catch (err) {
        if (err instanceof ReplTimeoutError) break;
        throw err;
      }
    }
    this.buffer.clear();
  }

  async stop(): Promise<void> {
    await this.writeChain.catch(() => undefined);
    const writer = this.writer;
    this.writer = null;
    if (writer) {
      try {
        writer.releaseLock();
      } catch {
        /* a writer mid-abort cannot be released; the close below cleans up */
      }
    }

    const reader = this.reader;
    this.reader = null;
    if (reader) {
      // cancel() unblocks the pending read() so the pump can finish.
      await reader.cancel().catch(() => undefined);
      await this.pump?.catch(() => undefined);
      try {
        reader.releaseLock();
      } catch {
        /* already released */
      }
    }
    this.pump = null;
  }
}

export class Repl {
  private channel: PortChannel | null = null;
  private port: SerialPort | null = null;
  private connected = false;
  private busy = false;

  isConnected(): boolean {
    return this.connected;
  }

  isBusy(): boolean {
    return this.busy;
  }

  /**
   * Connection sequence: interrupt whatever is running, let the noise settle,
   * then ask for raw mode and wait for the banner that proves this is
   * MicroPython. Retried once, because a board that was reset when the port
   * opened may swallow the first attempt while it boots.
   *
   * Everything received during the handshake is logged to the browser console
   * so a failed detection shows what the board actually said.
   */
  async connect(port: SerialPort): Promise<void> {
    const channel = new PortChannel(port);
    channel.start();
    this.channel = channel;
    this.port = port;

    channel.startCapture();
    try {
      for (let attempt = 1; ; attempt++) {
        try {
          await this.probe(channel);
          break;
        } catch (err) {
          if (!(err instanceof ReplTimeoutError) || attempt >= PROBE_ATTEMPTS) throw err;
          console.warn(`[repl] no raw REPL banner on attempt ${attempt}, retrying`);
        }
      }
      console.info(`[repl] handshake received ${describeBytes(channel.endCapture())}`);
      this.connected = true;
    } catch (err) {
      console.warn(`[repl] handshake failed; received ${describeBytes(channel.endCapture())}`);
      await channel.stop();
      this.channel = null;
      this.port = null;
      this.connected = false;
      if (err instanceof ReplTimeoutError) {
        throw new ReplError('Connected device does not appear to be running MicroPython.');
      }
      throw err;
    }
  }

  /** One interrupt-then-raw-mode attempt. Times out with ReplTimeoutError. */
  private async probe(channel: PortChannel): Promise<void> {
    await channel.write(bytes(CTRL_C));
    await delay(INTERRUPT_GAP_MS);
    await channel.write(bytes(CTRL_C));
    await channel.write(encoder.encode('\r\n'));
    await channel.discardFor(DISCARD_WINDOW_MS);
    await channel.write(bytes(CTRL_A));
    await channel.readUntil(encoder.encode(RAW_PROMPT_BANNER), RAW_PROMPT_TIMEOUT_MS);
  }

  /**
   * Run `code` on the device. Iterate the result to receive output as it
   * arrives; the iteration finishes when the device is back at its prompt.
   */
  execute(code: string): AsyncIterable<OutputChunk> {
    const channel = this.channel;
    if (!channel || !this.connected) {
      throw new ReplError('Not connected to a device');
    }
    if (this.busy) {
      throw new ReplError('A program is already running');
    }
    // Claimed here, not inside the generator, so a second execute() in the same
    // tick is rejected even before iteration starts.
    this.busy = true;
    return this.runCode(channel, code);
  }

  private async *runCode(channel: PortChannel, code: string): AsyncGenerator<OutputChunk> {
    // Separate decoders so a multi-byte character split across chunks survives.
    const stdout = new TextDecoder();
    const stderr = new TextDecoder();

    try {
      await channel.write(encoder.encode(code));
      await channel.write(bytes(CTRL_D));

      const ack = await channel.readExactly(2, ACK_TIMEOUT_MS);
      if (ack[0] !== 0x4f || ack[1] !== 0x4b) {
        // No "OK": the device rejected the submission outright. Everything up
        // to the prompt is the complaint, EOF markers and all.
        const rest = await channel.readUntil(encoder.encode(PROMPT), ACK_TIMEOUT_MS);
        const text = stderr.decode(ack) + stderr.decode(rest);
        const cleaned = normalizeNewlines(text).replace(/\u0004/g, '').trim();
        yield {
          stream: 'stderr',
          data: `${cleaned.length > 0 ? cleaned : 'Device rejected the program'}\n`,
        };
        return;
      }

      // No timeout on the output phases: the program may legitimately run for
      // minutes between prints.
      for await (const chunk of channel.streamUntilByte(EOF, null)) {
        const text = normalizeNewlines(stdout.decode(chunk, { stream: true }));
        if (text.length > 0) yield { stream: 'stdout', data: text };
      }
      for await (const chunk of channel.streamUntilByte(EOF, null)) {
        const text = normalizeNewlines(stderr.decode(chunk, { stream: true }));
        if (text.length > 0) yield { stream: 'stderr', data: text };
      }

      await channel.readUntil(encoder.encode(PROMPT), PROMPT_TIMEOUT_MS);
    } catch (err) {
      if (err instanceof ReplConnectionLostError) this.connected = false;
      throw err;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Ctrl-C. While a program is running the traceback and the following prompt
   * are consumed by the in-flight execute(); when idle we resync here so the
   * next execute() starts from a known prompt.
   */
  async interrupt(): Promise<void> {
    const channel = this.channel;
    if (!channel || !this.connected) return;
    await channel.write(bytes(CTRL_C));
    if (this.busy) return;
    try {
      await channel.readUntil(encoder.encode(PROMPT), PROMPT_TIMEOUT_MS);
    } catch {
      /* nothing was running; the prompt may never come and that is fine */
    }
  }

  /**
   * Ctrl-B first, so the board is left in the friendly REPL and mpremote or
   * Thonny can pick it up straight after. Skipped when the port is already
   * gone (`graceful: false`) — writing to a yanked cable only throws.
   */
  async disconnect(graceful = true): Promise<void> {
    const channel = this.channel;
    const port = this.port;
    this.channel = null;
    this.port = null;
    this.connected = false;
    this.busy = false;

    if (channel) {
      if (graceful) {
        await channel.write(bytes(CTRL_B)).catch(() => undefined);
      }
      await channel.stop();
    }
    if (port) {
      await port.close().catch(() => undefined);
    }
  }
}
