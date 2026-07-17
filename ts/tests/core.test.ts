import { describe, it, expect } from "vitest";
import {
  hrrToBpm,
  latestHrFromGarminData,
  BPM_FLOOR,
  BPM_CEILING,
  interleavedShuffle,
  SessionState,
  bpmQuality,
  qualityScore,
  selectSongsForSegment,
  type SegmentConfig,
  type SongCandidate,
} from "../src/index";

describe("bpm-formula (golden parity with the Python)", () => {
  it("0% HRR (resting) → 75", () => {
    expect(hrrToBpm(60, 60, 190)).toBe(75);
  });
  it("100% HRR (max) → 175", () => {
    expect(hrrToBpm(190, 60, 190)).toBe(175);
  });
  it("50% HRR (moderate) → 128", () => {
    expect(hrrToBpm(125, 60, 190)).toBe(128);
  });
  it("clamps below 0% HRR to the resting value", () => {
    expect(hrrToBpm(40, 60, 190)).toBe(75);
  });
  it("clamps above 100% HRR to the max value", () => {
    expect(hrrToBpm(220, 60, 190)).toBe(175);
  });
  it("pump-up offset adds to the base bpm", () => {
    expect(hrrToBpm(125, 60, 190, 12)).toBe(140);
  });
  it("wind-down offset subtracts from the base bpm", () => {
    expect(hrrToBpm(125, 60, 190, -12)).toBe(116);
  });
  it("exposes the clamp bounds", () => {
    expect(BPM_FLOOR).toBe(70);
    expect(BPM_CEILING).toBe(185);
  });
});

describe("latestHrFromGarminData", () => {
  const now = 1_000_000_000_000;
  it("returns the most recent reading within the window", () => {
    const data = { heartRateValues: [[now - 60_000, 120], [now - 10_000, 150]] as Array<[number, number | null]> };
    expect(latestHrFromGarminData(data, 120, now)).toEqual([150, (now - 10_000) / 1000]);
  });
  it("skips null readings and returns null when all are stale", () => {
    const data = { heartRateValues: [[now - 600_000, 120], [now - 5_000, null]] as Array<[number, number | null]> };
    expect(latestHrFromGarminData(data, 120, now)).toBeNull();
  });
});

describe("interleavedShuffle", () => {
  const mk = (id: string, artist: string): Record<string, any> => ({ track_id: id, artist_id: artist });
  const songs = [
    mk("1", "a"), mk("2", "a"), mk("3", "b"), mk("4", "b"), mk("5", "c"), mk("6", "c"),
  ];

  it("preserves the multiset of tracks", () => {
    const out = interleavedShuffle(songs.map((s) => ({ ...s })));
    expect(out.map((s) => s.track_id).sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("spreads same-artist tracks (no 3-in-a-row when artists are balanced)", () => {
    for (let trial = 0; trial < 50; trial++) {
      const out = interleavedShuffle(songs.map((s) => ({ ...s })));
      for (let i = 2; i < out.length; i++) {
        const run = out[i].artist_id === out[i - 1].artist_id && out[i - 1].artist_id === out[i - 2].artist_id;
        expect(run).toBe(false);
      }
    }
  });

  it("rotates so position 0 is not the last-played artist", () => {
    const state = new SessionState();
    state.lastPlayedArtistId = "a";
    for (let trial = 0; trial < 50; trial++) {
      const out = interleavedShuffle(songs.map((s) => ({ ...s })), state);
      expect(out[0].artist_id).not.toBe("a");
    }
  });

  it("SessionState filters played + skipped", () => {
    const state = new SessionState();
    state.markPlayed("1");
    state.markSkipped("3");
    expect(state.filterCandidates(songs).map((s) => s.track_id)).toEqual(["2", "4", "5", "6"]);
  });

  it("returns [] for empty input", () => {
    expect(interleavedShuffle([])).toEqual([]);
  });
});

describe("playlist-algorithm", () => {
  const cfg: SegmentConfig = {
    duration_s: 600, bpm_min: 150, bpm_max: 170, bpm_tolerance: 5,
    min_energy: 0.6, valence_min: 0.3, valence_max: 0.9, half_time: false,
  };

  it("bpmQuality peaks (=1) at the band center", () => {
    expect(bpmQuality(160, cfg)).toBe(1); // center of 150..170
    expect(bpmQuality(160, cfg)).toBeGreaterThan(bpmQuality(140, cfg));
  });

  it("qualityScore stays within [0, 1]", () => {
    const s = qualityScore({ tempo: 160, energy: 0.7 }, cfg);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it("selectSongsForSegment respects the capacity and returns a subset", () => {
    const mk = (id: string, dur: number, tempo: number): SongCandidate => ({
      track_id: id, name: id, artist_name: "x", artist_id: "x", duration_ms: dur * 1000,
      tempo, energy: 0.7, valence: 0.5, quality_score: bpmQuality(tempo, cfg),
    });
    const pool = [mk("a", 200, 160), mk("b", 200, 160), mk("c", 200, 160), mk("d", 200, 100)];
    const picked = selectSongsForSegment(pool, 420); // fits ~2 songs
    const total = picked.reduce((s, p) => s + p.duration_ms / 1000, 0);
    expect(total).toBeLessThanOrEqual(420);
    expect(picked.length).toBeGreaterThan(0);
    expect(new Set(picked.map((p) => p.track_id)).size).toBe(picked.length); // no dups
  });
});
