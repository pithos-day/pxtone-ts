import { describe, it, expect } from "vitest";
import { MemoryIo } from "../src/data.js";
import { Master } from "../src/master.js";
import { PxtnText } from "../src/text.js";
import { Delay, DelayUnit } from "../src/delay.js";
import { OverDrive } from "../src/overdrive.js";
import { Evelist } from "../src/evelist.js";
import { EventKind } from "../src/event.js";
import { PxtnErr } from "../src/error.js";

describe("Master", () => {
  it("round-trips io_w_v5 / io_r_v5", () => {
    const m = new Master();
    m.set(3, 140, 240);
    m.setRepeatMeas(2);
    m.setLastMeas(5);
    const io = new MemoryIo();
    m.ioWV5(io, 1);
    const m2 = new Master();
    io.seek(0, 0);
    expect(m2.ioRV5(io)).toBe(PxtnErr.OK);
    expect(m2.beatNum).toBe(3);
    expect(m2.beatTempo).toBe(140);
    expect(m2.beatClock).toBe(240);
    expect(m2.repeatMeas).toBe(2);
    expect(m2.lastMeas).toBe(5);
  });

  it("computes clocks and adjusts meas num", () => {
    const m = new Master();
    m.set(4, 120, 480);
    m.adjustMeasNum(480 * 4 * 3); // 3小節分
    expect(m.measNum).toBe(3);
    expect(m.getThisClock(2, 1, 0)).toBe(480 * 4 * 2 + 480);
  });
});

describe("PxtnText", () => {
  it("stores raw bytes and round-trips", () => {
    const t = new PxtnText();
    const bytes = new TextEncoder().encode("タイトル");
    t.setNameBuf(bytes);
    const io = new MemoryIo();
    expect(t.nameW(io)).toBe(true);
    const t2 = new PxtnText();
    io.seek(0, 0);
    expect(t2.nameR(io)).toBe(true);
    expect(t2.getNameBuf()).toEqual(bytes);
  });

  it("commentW fails when empty", () => {
    const t = new PxtnText();
    expect(t.commentW(new MemoryIo())).toBe(false);
  });
});

describe("Delay", () => {
  it("round-trips write/read", () => {
    const d = new Delay();
    d.set(DelayUnit.Meas, 2.0, 40.0, 3);
    const io = new MemoryIo();
    d.write(io);
    const d2 = new Delay();
    io.seek(0, 0);
    expect(d2.read(io)).toBe(PxtnErr.OK);
    expect(d2.unit).toBe(DelayUnit.Meas);
    expect(d2.freq).toBe(2.0);
    expect(d2.rate).toBe(40.0);
    expect(d2.group).toBe(3);
  });

  it("toneSupple applies feedback", () => {
    const d = new Delay();
    d.set(DelayUnit.Beat, 1.0, 50.0, 0);
    expect(d.toneReady(4, 120, 44100)).toBe(PxtnErr.OK);
    const g = new Int32Array(8);
    g[0] = 1000;
    d.toneSupple(0, g);
    expect(g[0]).toBe(1000); // buf=0 + feedback0
    g[0] = 2000;
    d.toneSupple(0, g);
    expect(g[0]).toBe(2500); // 2000 + buf(1000)*50/100
    d.toneIncrement();
    d.toneClear();
  });
});

describe("OverDrive", () => {
  it("clips symmetric and applies gain", () => {
    const od = new OverDrive();
    od.set(90, 2.0, 0);
    od.toneReady();
    expect(od.cut).toBe(90);
    // cut_top = 32767 * (100-90)/100 = 3276
    const g = new Int32Array(8);
    g[0] = 100000;
    od.toneSupple(g);
    expect(g[0]).toBe(Math.trunc((32767 * 10) / 100) * 2);
    g[0] = -100000;
    od.toneSupple(g);
    expect(g[0]).toBe(-Math.trunc((32767 * 10) / 100) * 2);
  });

  it("rejects invalid ranges", () => {
    // size=16, xxx=0, group=0, cut=0.0(範囲外), amp=2.0, yyy=0
    const io = new MemoryIo(
      new Uint8Array([16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 128, 64, 0, 0, 0, 0]),
    );
    const od = new OverDrive();
    io.seek(0, 0);
    expect(od.read(io)).toBe(PxtnErr.FMT_UNKNOWN);
  });
});

describe("Evelist", () => {
  it("builds linked list and rounds trips", () => {
    const ev = new Evelist();
    expect(ev.allocate(64)).toBe(true);
    ev.recordAddI(480, 0, EventKind.KEY, 0x6000);
    ev.recordAddI(480, 0, EventKind.VOLUME, 104);
    ev.recordAddI(960, 0, EventKind.ON, 480); // tail
    expect(ev.count).toBe(3);

    const io = new MemoryIo();
    expect(ev.ioWrite(io, 1)).toBe(true);

    const ev2 = new Evelist();
    ev2.allocate(64);
    io.seek(0, 0);
    expect(ev2.ioRead(io)).toBe(PxtnErr.OK);
    ev2.linearEnd(true); // io_Read 後は Linear_End(true) が呼ばれる契約
    expect(ev2.count).toBe(3);
    const recs = ev2.records;
    expect(recs[0]!.kind).toBe(EventKind.KEY);
    expect(recs[0]!.clock).toBe(480);
    expect(recs[2]!.kind).toBe(EventKind.ON);
    expect(recs[2]!.value).toBe(480);
  });

  it("write byte layout with rough division", () => {
    const ev = new Evelist();
    ev.allocate(16);
    ev.recordAddI(100, 0, EventKind.ON, 200); // tail: value/rough
    const io = new MemoryIo();
    ev.ioWrite(io, 10);
    const out = io.toUint8Array();
    // size(4) + eve_num(4) + varint clock(1) + unit(1) + kind(1) + varint value(1) = 12
    expect(out.length).toBe(12);
    expect(out[8]).toBe(10); // clock/rough = 100/10
    expect(out[9]).toBe(0);
    expect(out[10]).toBe(EventKind.ON);
    expect(out[11]).toBe(20); // 200/10
  });

  it("getValue uses default", () => {
    const ev = new Evelist();
    ev.allocate(8);
    expect(ev.getValue(0, 0, EventKind.VOLUME)).toBe(104);
  });
});