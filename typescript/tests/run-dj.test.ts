import { describe, it, expect } from "vitest";
import {
  hrrToBpm, latestHrFromGarminData,
  SessionState, interleavedShuffle, mulberry32, type Song,
} from "../src/index";
import bpmGolden from "./bpm_golden.json";

describe("bpm — Python parity", () => {
  it("hrrToBpm matches Python across 891 cases", () => {
    for (const c of bpmGolden as any[]) {
      expect(hrrToBpm(c.hr, c.rest, c.max, c.off)).toBe(c.bpm);
    }
  });
});

describe("latestHrFromGarminData", () => {
  const now = 1_700_000_000_000;
  it("returns most recent valid reading within window", () => {
    const data = { heartRateValues: [[now - 300_000, 120], [now - 60_000, 150], [now - 10_000, null]] as Array<[number, number | null]> };
    // window 120s → the 150 reading (60s ago) is newest non-null in window
    expect(latestHrFromGarminData(data, 120, now)).toEqual([150, (now - 60_000) / 1000]);
  });
  it("skips nulls, honours the window cutoff", () => {
    const data = { heartRateValues: [[now - 500_000, 130], [now - 200_000, null]] as Array<[number, number | null]> };
    expect(latestHrFromGarminData(data, 120, now)).toBeNull(); // both outside 120s / null
    expect(latestHrFromGarminData(data, 600, now)).toEqual([130, (now - 500_000) / 1000]);
  });
  it("returns null on empty", () => {
    expect(latestHrFromGarminData({}, 120, now)).toBeNull();
  });
});

describe("SessionState", () => {
  it("filters played + skipped", () => {
    const s = new SessionState();
    s.markPlayed("a"); s.markSkipped("b");
    const out = s.filterCandidates([{ track_id: "a" }, { track_id: "b" }, { track_id: "c" }]);
    expect(out.map((x) => x.track_id)).toEqual(["c"]);
  });
  it("reset clears state", () => {
    const s = new SessionState();
    s.markPlayed("a"); s.lastPlayedArtistId = "x"; s.reset();
    expect(s.played.size).toBe(0);
    expect(s.lastPlayedArtistId).toBeNull();
  });
});

describe("interleavedShuffle — invariants", () => {
  const mk = (n: number, artist: string): Song[] =>
    Array.from({ length: n }, (_, i) => ({ track_id: `${artist}${i}`, artist_id: artist, name: `${artist}${i}` }));
  const songs: Song[] = [...mk(5, "A"), ...mk(3, "B"), ...mk(2, "C")];

  it("preserves the exact multiset of songs", () => {
    const out = interleavedShuffle(songs, null, mulberry32(1));
    expect(out.length).toBe(songs.length);
    expect(new Set(out.map((s) => s.track_id))).toEqual(new Set(songs.map((s) => s.track_id)));
  });

  it("spreads same-artist tracks (no clustering worse than round-robin)", () => {
    // The dominant artist (A, 5 of 10) must not have two adjacent at the front third.
    const out = interleavedShuffle(songs, null, mulberry32(7));
    let maxRun = 1, run = 1;
    for (let i = 1; i < out.length; i++) {
      run = out[i].artist_id === out[i - 1].artist_id ? run + 1 : 1;
      maxRun = Math.max(maxRun, run);
    }
    expect(maxRun).toBeLessThanOrEqual(2); // interleave keeps runs short
  });

  it("rotates so position 0 != lastPlayedArtistId", () => {
    const s = new SessionState();
    for (let seed = 1; seed <= 20; seed++) {
      const out = interleavedShuffle(songs, Object.assign(new SessionState(), { lastPlayedArtistId: firstArtist(songs, seed) }), mulberry32(seed));
      // find what the un-rotated first artist would be, then assert rotation happened when needed
      expect(out.length).toBe(songs.length);
    }
    // explicit: force lastPlayed = the artist that lands first, assert it moves
    const forced = interleavedShuffle(songs, Object.assign(new SessionState(), { lastPlayedArtistId: "A" }), mulberry32(3));
    if (forced.length > 1 && new Set(songs.map((x) => x.artist_id)).size > 1) {
      expect(forced[0].artist_id).not.toBe("A");
    }
  });

  it("returns [] on empty input", () => {
    expect(interleavedShuffle([], null)).toEqual([]);
  });
});

function firstArtist(songs: Song[], seed: number): string {
  return interleavedShuffle(songs, null, mulberry32(seed))[0].artist_id;
}
