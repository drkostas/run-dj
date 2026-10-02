/**
 * run-dj — the pure, I/O-free core of Soma's running DJ.
 *
 * Three self-contained algorithm modules, no runtime dependencies:
 *  - bpm-formula      heart-rate-reserve → target cadence BPM
 *  - dj-shuffle       interleaved partition shuffle (anti-clustering)
 *  - playlist-algorithm  segment-based track scoring + selection
 *  - cycle            the live DJ's queue decision (when to queue, what next)
 *  - genre            micro-genre strings to the DJ's macro-genre buckets
 *  - reccobeats       audio features (tempo, energy, ...) per Spotify track
 *  - spotify          the Web API client over a token store the consumer supplies
 *
 * The DB / Spotify / Garmin I/O and the live poll loop stay in the consumer
 * (Soma's Vercel cron + dj-daemon glue). This package is the brain only.
 */
export * from "./bpm-formula";
export * from "./dj-shuffle";
export * from "./playlist-algorithm";
export * from "./cycle";
export * from "./genre";
export * from "./reccobeats";
export * from "./spotify";
export * from "./segments";
