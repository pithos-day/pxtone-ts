import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MemoryIo, intToVBytes, dataCheckVSize, dataWriteV, dataReadV } from "../src/data.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "fixtures", "varint_ref.txt");

function parseRef(): { value: number; hex: string; size: number }[] {
  const lines = readFileSync(fixturePath, "utf8").split("\n");
  const out: { value: number; hex: string; size: number }[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = /^(-?\d+) ([0-9a-f]+) size=(\d+) consumed=\d+ dec=(-?\d+)$/.exec(line);
    if (!m) throw new Error("fixture parse error: " + line);
    out.push({ value: Number(m[1]), hex: m[2]!, size: Number(m[3]) });
  }
  return out;
}

describe("varint", () => {
  const refs = parseRef();

  it("matches C++ reference encode bytes", () => {
    for (const { value, hex } of refs) {
      const bytes = intToVBytes(value);
      const n = dataCheckVSize(value);
      const hexTs = Array.from(bytes.slice(0, n))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      expect(hexTs, `value=${value}`).toBe(hex);
      expect(n * 2, `value=${value}`).toBe(hex.length);
    }
  });

  it("round-trips via MemoryIo and matches reference decode", () => {
    for (const { value } of refs) {
      const io = new MemoryIo();
      dataWriteV(io, value);
      io.seek(0, 0);
      const back = dataReadV(io);
      expect(back, `value=${value}`).toBe(value);
    }
  });

  it("size matches _data_check_v_size", () => {
    for (const { value, size } of refs) {
      expect(dataCheckVSize(value)).toBe(size);
    }
  });

  it("rejects truncated read", () => {
    const io = new MemoryIo(new Uint8Array([0x80]));
    io.seek(0, 0);
    expect(dataReadV(io)).toBe(null);
  });

  it("rejects a varint whose 5 bytes all have the continuation bit", () => {
    const io = new MemoryIo(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80]));
    io.seek(0, 0);
    expect(dataReadV(io)).toBe(null);
  });
});
