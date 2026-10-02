import { describe, it, expect } from "vitest";
import { BPM_DEFAULTS, flatItems, makeSegment, parsedToItems, segsForGenerate, type RepeatGroup, type Segment } from "../src/segments";

let n = 0;
const id = () => `id${n++}`;

describe("makeSegment", () => {
  it("takes the type's BPM and valence range", () => {
    const s = makeSegment({ type: "tempo", duration_s: 900 }, id);
    expect(s).toMatchObject({ type: "tempo", duration_s: 900, bpm_min: 160, bpm_max: 180, bpm_tolerance: 8, sync_mode: "auto", valence_min: 0.1, valence_max: 0.5 });
  });
  it("⛔ turns an unknown type into easy, so every segment has a known range", () => {
    expect(makeSegment({ type: "fartlek" }, id)).toMatchObject({ type: "easy", duration_s: 600, bpm_min: BPM_DEFAULTS.easy.min });
  });
});

describe("parsedToItems", () => {
  it("expands a repeat into every iteration, with new ids after the first", () => {
    const [g] = parsedToItems([{ type: "repeat", repeat_count: 3, children: [{ type: "interval", duration_s: 180 }, { type: "recovery", duration_s: 90 }] }], id) as RepeatGroup[];
    expect(g).toMatchObject({ type: "repeat", repeat_count: 3, template_size: 2 });
    expect(g.children.map((c) => c.type)).toEqual(["interval", "recovery", "interval", "recovery", "interval", "recovery"]);
    expect(new Set(g.children.map((c) => c.id)).size).toBe(6);
  });
  it("drops nested repeats, and an empty repeat becomes one easy segment", () => {
    const items = parsedToItems([{ type: "repeat", repeat_count: 2, children: [{ type: "repeat", repeat_count: 2, children: [] }] }], id);
    expect(items[0]).toMatchObject({ type: "easy", duration_s: 600 });
  });
});

describe("segsForGenerate", () => {
  const warm: Segment = makeSegment({ type: "warmup", duration_s: 600 }, id);
  it("keeps a plain segment one to one", () => {
    expect(segsForGenerate([warm], id)).toEqual({ segments: [warm], flatIndexMap: [[0]] });
  });
  it("collapses a short repeat group (strides) into one block at its main step's range", () => {
    const strides = parsedToItems([{ type: "repeat", repeat_count: 4, children: [{ type: "strides", duration_s: 20 }, { type: "recovery", duration_s: 60 }] }], id);
    const out = segsForGenerate([warm, ...strides], id);
    expect(out.segments).toHaveLength(2);
    expect(out.segments[1]).toMatchObject({ type: "strides", duration_s: 4 * 80 });
    expect(out.flatIndexMap[1]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("pools each step type across a long repeat group (5 x 1000 m)", () => {
    const reps = parsedToItems([{ type: "repeat", repeat_count: 5, children: [{ type: "interval", duration_s: 240 }, { type: "recovery", duration_s: 120 }] }], id);
    const out = segsForGenerate(reps, id);
    expect(out.segments.map((s) => [s.type, s.duration_s])).toEqual([["interval", 1200], ["recovery", 600]]);
    expect(out.flatIndexMap).toEqual([[0, 2, 4, 6, 8], [1, 3, 5, 7, 9]]);
    expect(flatItems(reps)).toHaveLength(10);
  });
});
