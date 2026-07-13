/**
 * Interleaved partition shuffle — TS port of run-dj shuffle.py.
 *
 * Spreads same-artist songs evenly (feels more random to humans than
 * Fisher-Yates because it prevents birthday-paradox clustering).
 */

export type Song = Record<string, any>;

/** Deterministic RNG hook: returns a float in [0, 1). Defaults to Math.random. */
export type Rng = () => number;

/** mulberry32 seedable PRNG — pass to interleavedShuffle for reproducible orders. */
export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates in place using the supplied RNG. */
function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Tracks per-session exclusions and last-played context. */
export class SessionState {
  played: Set<string> = new Set();
  skipped: Set<string> = new Set();
  lastPlayedArtistId: string | null = null;

  markPlayed(trackId: string): void { this.played.add(trackId); }
  markSkipped(trackId: string): void { this.skipped.add(trackId); }

  filterCandidates(songs: Song[]): Song[] {
    return songs.filter((s) => !this.played.has(s.track_id) && !this.skipped.has(s.track_id));
  }

  reset(): void {
    this.played.clear();
    this.skipped.clear();
    this.lastPlayedArtistId = null;
  }
}

/** Stable artist identifier, falling back to a slug from artist_name. */
function artistKey(song: Song): string {
  return song.artist_id || String(song.artist_name ?? "").toLowerCase().replace(/ /g, "_");
}

/**
 * Return songs shuffled so same-artist tracks are evenly spread.
 * 1. partition by artist  2. shuffle within each  3. interleave (largest first)
 * 4. if state given, rotate so the first song's artist != lastPlayedArtistId.
 *
 * `rng` is injectable for reproducibility (defaults to Math.random).
 */
export function interleavedShuffle(songs: Song[], state?: SessionState | null, rng: Rng = Math.random): Song[] {
  if (songs.length === 0) return [];

  // 1. Partition by artist
  const byArtist = new Map<string, Song[]>();
  for (const song of songs) {
    const key = artistKey(song);
    if (!byArtist.has(key)) byArtist.set(key, []);
    byArtist.get(key)!.push(song);
  }

  // 2. Shuffle within each partition (reverse so pop() from tail is O(1))
  for (const partition of byArtist.values()) {
    shuffleInPlace(partition, rng);
    partition.reverse();
  }

  // 3. Interleave: partitions by size desc, round-robin
  let partitions = [...byArtist.values()].sort((a, b) => b.length - a.length);
  const result: Song[] = [];
  while (partitions.length) {
    for (const p of partitions) {
      const s = p.pop();
      if (s !== undefined) result.push(s);
    }
    partitions = partitions.filter((p) => p.length);
  }

  // 4. Rotate so position 0 isn't the last-played artist (if any valid rotation exists).
  if (state && state.lastPlayedArtistId && result.length) {
    for (let i = 0; i < result.length; i++) {
      if (artistKey(result[i]) !== state.lastPlayedArtistId) {
        return result.slice(i).concat(result.slice(0, i));
      }
    }
  }

  return result;
}
