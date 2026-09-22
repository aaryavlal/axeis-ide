/**
 * Output panel.
 *
 * Writes are queued and flushed once per animation frame. Runaway output
 * therefore costs one layout per frame instead of one per print, which is what
 * keeps the page responsive when a program dumps tens of thousands of lines.
 */

export type ConsoleStream = 'stdout' | 'stderr' | 'system' | 'action';

const MAX_LINES = 10_000;
const TRUNCATION_NOTICE = 'Output truncated — 10,000 line limit reached.';
/** Scroll slack, in px, for calling the view "at the bottom". */
const BOTTOM_EPSILON = 4;

interface PendingWrite {
  stream: ConsoleStream;
  text: string;
}

export class ConsolePanel {
  private readonly pending: PendingWrite[] = [];
  private frame: number | null = null;
  private lineCount = 0;
  private truncated = false;
  /** The trailing line that has not been ended by a newline yet. */
  private openLine: HTMLElement | null = null;
  private openStream: ConsoleStream | null = null;

  constructor(
    private readonly log: HTMLElement,
    private readonly notice: HTMLElement,
  ) {}

  /** Append raw text; embedded newlines split it into lines. */
  write(stream: ConsoleStream, text: string): void {
    if (text.length === 0) return;
    this.pending.push({ stream, text });
    this.schedule();
  }

  /** Append text as its own complete line. */
  writeLine(stream: ConsoleStream, text: string): void {
    this.write(stream, `${text}\n`);
  }

  clear(): void {
    this.pending.length = 0;
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.log.replaceChildren();
    this.lineCount = 0;
    this.openLine = null;
    this.openStream = null;
    this.truncated = false;
    this.notice.hidden = true;
    this.notice.textContent = '';
  }

  private schedule(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.flush();
    });
  }

  private flush(): void {
    if (this.pending.length === 0) return;
    // Sampled before the DOM grows, so a user who scrolled up stays put.
    const stick = this.isAtBottom();

    for (const item of this.pending) {
      this.append(item.stream, item.text);
    }
    this.pending.length = 0;

    this.trim();
    if (stick) this.log.scrollTop = this.log.scrollHeight;
  }

  private isAtBottom(): boolean {
    const distance = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight;
    return distance <= BOTTOM_EPSILON;
  }

  private append(stream: ConsoleStream, text: string): void {
    const parts = text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] ?? '';
      const isLast = i === parts.length - 1;
      if (part.length > 0) {
        this.ensureLine(stream).append(part);
      }
      if (!isLast) {
        // A newline ends this line; make sure a blank one is still visible.
        if (!this.openLine) this.ensureLine(stream);
        this.openLine = null;
        this.openStream = null;
      }
    }
  }

  private ensureLine(stream: ConsoleStream): HTMLElement {
    if (this.openLine && this.openStream === stream) return this.openLine;
    const line = document.createElement('div');
    line.className = `console-line console-${stream}`;
    this.log.append(line);
    this.lineCount++;
    this.openLine = line;
    this.openStream = stream;
    return line;
  }

  private trim(): void {
    if (this.lineCount <= MAX_LINES) return;
    while (this.lineCount > MAX_LINES) {
      const oldest = this.log.firstElementChild;
      // The open line is always last, so trimming never strands it.
      if (!oldest || oldest === this.openLine) break;
      oldest.remove();
      this.lineCount--;
    }
    if (!this.truncated) {
      this.truncated = true;
      this.notice.textContent = TRUNCATION_NOTICE;
      this.notice.hidden = false;
    }
  }
}
