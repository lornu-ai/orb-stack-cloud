import { describe, expect, test } from "bun:test";
import { LineReader } from "./lines";

const reader = () => new LineReader(new ReadableStream<Uint8Array>({ start() {} }));

describe("LineReader", () => {
  test("splits pushed text into lines and buffers partial lines", async () => {
    const r = reader();
    r.push("a\nb");
    expect(await r.next(10)).toBe("a");
    expect(await r.next(10)).toBeUndefined();
    r.push("c\n");
    expect(await r.next(10)).toBe("bc");
  });

  test("resolves a waiter as soon as a line arrives", async () => {
    const r = reader();
    const pending = r.next(1000);
    r.push("event\n");
    expect(await pending).toBe("event");
  });

  test("drain discards buffered lines; end releases waiters", async () => {
    const r = reader();
    r.push("old\n");
    r.drain();
    const pending = r.next(1000);
    r.end();
    expect(await pending).toBeUndefined();
    expect(await r.next(10)).toBeUndefined();
  });

  test("reads from a real stream", async () => {
    const r = new LineReader(new Response("x\ny\n").body!);
    expect(await r.next(1000)).toBe("x");
    expect(await r.next(1000)).toBe("y");
  });
});
