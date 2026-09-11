import { describe, it, expect } from "vitest";
import { toMacroGenres, MACRO_GENRES } from "../src/genre";

describe("toMacroGenres", () => {
  it("maps micro-genres to unique buckets, first match wins per micro-genre", () => {
    expect(toMacroGenres(["melodic rap", "cloud rap", "dark trap"])).toEqual(["Hip-Hop"]);
    expect(toMacroGenres(["indie rock", "shoegaze", "techno"])).toEqual(["Indie", "Electronic"]);
  });
  it("is case-insensitive and substring-based", () => {
    expect(toMacroGenres(["Deep HOUSE", "german techno"])).toEqual(["Electronic"]);
  });
  it("drops what no bucket recognises", () => {
    expect(toMacroGenres(["zzz-unknown", "polka"])).toEqual([]);
  });
  it("every bucket has patterns and every pattern is lowercase", () => {
    for (const [bucket, patterns] of Object.entries(MACRO_GENRES)) {
      expect(patterns.length, bucket).toBeGreaterThan(0);
      for (const p of patterns) expect(p).toBe(p.toLowerCase());
    }
  });
});
