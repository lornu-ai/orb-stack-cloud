/** Line-at-a-time reader over a byte stream, for timing events printed by a child process. */
export class LineReader {
  private buffer = "";
  private readonly lines: string[] = [];
  private waiters: ((line: string | undefined) => void)[] = [];
  private done = false;

  constructor(stream: ReadableStream<Uint8Array>) {
    void this.pump(stream);
  }

  /** Feed text directly; used by the stream pump and by tests. */
  push(text: string): void {
    this.buffer += text;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      const waiter = this.waiters.shift();
      if (waiter) waiter(line);
      else this.lines.push(line);
    }
  }

  end(): void {
    this.done = true;
    for (const w of this.waiters.splice(0)) w(undefined);
  }

  /** Next line, or undefined on timeout or end of stream. */
  next(timeoutMs: number): Promise<string | undefined> {
    const queued = this.lines.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.done) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const waiter = (line: string | undefined) => {
        clearTimeout(timer);
        resolve(line);
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        resolve(undefined);
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  /** Discard anything already buffered. */
  drain(): void {
    this.lines.length = 0;
  }

  private async pump(stream: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    for await (const chunk of stream) this.push(decoder.decode(chunk, { stream: true }));
    this.end();
  }
}
