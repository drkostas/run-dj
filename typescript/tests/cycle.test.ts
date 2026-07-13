import { describe, it, expect } from "vitest";
import {
  decideQueue, selectNextTrack, bpmSearchTargets,
  QUEUE_AHEAD_MS, HR_SHIFT_THRESHOLD,
  SessionState, mulberry32, type Song, type QueueDecisionInputs,
} from "../src/index";
import cycleGolden from "./cycle_golden.json";

const base: QueueDecisionInputs = {
  targetBpm: 140, firstQueueDone: true, queuedTrackId: null,
  trackJustChanged: false, msRemaining: 120_000, lastTargetBpm: 140,
};

describe("decideQueue — full branch cascade (dj_daemon parity)", () => {
  it("no HR → no_hr, no queue", () => {
    expect(decideQueue({ ...base, targetBpm: null })).toEqual({ shouldQueue: false, reason: null, noQueueReason: "no_hr" });
  });
  it("first cycle → initial queue", () => {
    expect(decideQueue({ ...base, firstQueueDone: false })).toEqual({ shouldQueue: true, reason: "initial", noQueueReason: null });
  });
  it("already queued → hold", () => {
    expect(decideQueue({ ...base, queuedTrackId: "t1" })).toEqual({ shouldQueue: false, reason: null, noQueueReason: "already_queued" });
  });
  it("track just changed → queue next (track_started)", () => {
    expect(decideQueue({ ...base, trackJustChanged: true })).toEqual({ shouldQueue: true, reason: "track_started", noQueueReason: null });
  });
  it("under 45s remaining → queue (45s_remaining)", () => {
    expect(decideQueue({ ...base, msRemaining: QUEUE_AHEAD_MS - 1 })).toEqual({ shouldQueue: true, reason: "45s_remaining", noQueueReason: null });
  });
  it("big HR shift → queue with hr_shift reason", () => {
    const d = decideQueue({ ...base, targetBpm: 150, lastTargetBpm: 140 });
    expect(d.shouldQueue).toBe(true);
    expect(d.reason).toBe("hr_shift_140_to_150");
  });
  it("HR shift below threshold → no queue", () => {
    expect(decideQueue({ ...base, targetBpm: 140 + HR_SHIFT_THRESHOLD - 1, lastTargetBpm: 140 }))
      .toEqual({ shouldQueue: false, reason: null, noQueueReason: null });
  });
  it("priority: already_queued beats track_started", () => {
    expect(decideQueue({ ...base, queuedTrackId: "t1", trackJustChanged: true }).noQueueReason).toBe("already_queued");
  });
});

describe("bpmSearchTargets — Python round() parity (141 cases)", () => {
  it("matches Python exactly incl. odd×0.5 half-to-even", () => {
    for (const c of cycleGolden as any[]) expect(bpmSearchTargets(c.bpm)).toEqual(c.targets);
  });
  it("125 → [62, 125] (round(62.5)=62, not 63)", () => {
    expect(bpmSearchTargets(125)).toEqual([62, 125]);
  });
});

describe("selectNextTrack", () => {
  const mk = (id: string, artist: string): Song => ({ track_id: id, artist_id: artist, name: id, tempo: 140 });
  it("excludes played/skipped/current, returns a candidate", () => {
    const s = new SessionState();
    s.markPlayed("a"); s.markSkipped("b");
    const cands = [mk("a", "X"), mk("b", "Y"), mk("c", "Z"), mk("d", "W")];
    const pick = selectNextTrack(cands, s, "c", mulberry32(1));
    expect(pick).not.toBeNull();
    expect(["a", "b", "c"]).not.toContain(pick!.track_id); // only "d" survives
    expect(pick!.track_id).toBe("d");
  });
  it("returns null when all candidates excluded", () => {
    const s = new SessionState();
    s.markPlayed("a");
    expect(selectNextTrack([mk("a", "X")], s, null, mulberry32(1))).toBeNull();
  });
  it("returns null on empty candidate list", () => {
    expect(selectNextTrack([], new SessionState())).toBeNull();
  });
});
