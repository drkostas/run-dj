/**
 * DJ queue-decision core — the pure "brain" of the live DJ, extracted from
 * dj_daemon.py's poll loop. No I/O: given the target BPM and the current
 * session/playback state, decide whether to queue a next track and why, then
 * pick one from candidate tracks. The DB/Spotify/Garmin I/O and the rolling
 * history bookkeeping live in the consumer (soma's Vercel-Cron cycle).
 */
import { SessionState, interleavedShuffle, type Song, type Rng } from "./shuffle";

/** Python round() at ndigits=0: round-half-to-even, but only on an exact .5. */
function pyRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** Queue the next song when this many ms remain in the current one. */
export const QUEUE_AHEAD_MS = 45_000;
/** A target-BPM change of at least this many BPM triggers a queue replacement. */
export const HR_SHIFT_THRESHOLD = 8;

export interface QueueDecisionInputs {
  /** Target music BPM for the current effort, or null when HR is unavailable. */
  targetBpm: number | null;
  /** Has a track been queued/played at least once this session? */
  firstQueueDone: boolean;
  /** Track id currently sitting in the Spotify queue (null if none pending). */
  queuedTrackId: string | null;
  /** True when the currently-playing track changed since the last poll. */
  trackJustChanged: boolean;
  /** Milliseconds remaining in the currently-playing track (null if unknown). */
  msRemaining: number | null;
  /** Target BPM from the previous successful HR read (null if none yet). */
  lastTargetBpm: number | null;
}

export interface QueueDecision {
  shouldQueue: boolean;
  /** Why we're queuing (initial | track_started | 45s_remaining | hr_shift_A_to_B), or null. */
  reason: string | null;
  /** Why we're NOT queuing (no_hr | already_queued), or null. */
  noQueueReason: string | null;
}

/**
 * Decide whether to queue the next track this cycle. Pure port of dj_daemon
 * lines 563-590 (the should_queue / replace_reason / no_queue_reason cascade).
 */
export function decideQueue(i: QueueDecisionInputs): QueueDecision {
  if (i.targetBpm === null) return { shouldQueue: false, reason: null, noQueueReason: "no_hr" };
  if (!i.firstQueueDone) return { shouldQueue: true, reason: "initial", noQueueReason: null };
  if (i.queuedTrackId !== null) return { shouldQueue: false, reason: null, noQueueReason: "already_queued" };
  if (i.trackJustChanged) return { shouldQueue: true, reason: "track_started", noQueueReason: null };
  if (i.msRemaining !== null) {
    if (i.msRemaining < QUEUE_AHEAD_MS) return { shouldQueue: true, reason: "45s_remaining", noQueueReason: null };
    if (i.lastTargetBpm !== null && Math.abs(i.targetBpm - i.lastTargetBpm) >= HR_SHIFT_THRESHOLD)
      return { shouldQueue: true, reason: `hr_shift_${i.lastTargetBpm}_to_${i.targetBpm}`, noQueueReason: null };
  }
  return { shouldQueue: false, reason: null, noQueueReason: null };
}

/**
 * Pick the next track from candidate rows: exclude already played/skipped and
 * the current track, then session-filter + interleaved-shuffle and take the
 * head. Returns null when nothing is left. Pure port of dj_daemon lines 592-607.
 * `rng` is injectable for reproducible tests (defaults to Math.random).
 */
export function selectNextTrack(
  candidates: Song[],
  session: SessionState,
  currentTrackId: string | null = null,
  rng: Rng = Math.random,
): Song | null {
  const exclude = new Set<string>([...session.played, ...session.skipped]);
  if (currentTrackId) exclude.add(currentTrackId);
  const pool = candidates.filter((s) => !exclude.has(s.track_id));
  const filtered = session.filterCandidates(pool);
  const shuffled = interleavedShuffle(filtered, session, rng);
  return shuffled.length ? shuffled[0] : null;
}

/**
 * The BPM targets a track query should search: the exact target plus half and
 * double tempo (each clamped to 60..200, and rounded). Pure port of dj_daemon
 * lines 221-226 — the DB query itself stays consumer-side.
 */
export function bpmSearchTargets(targetBpm: number): number[] {
  const targets = new Set<number>([targetBpm]);
  for (const mult of [0.5, 2.0]) {
    const alt = pyRound(targetBpm * mult);
    if (alt >= 60 && alt <= 200) targets.add(alt);
  }
  return [...targets].sort((a, b) => a - b);
}
