# run-dj

HR → music BPM mapping + session shuffle engine.

`run-dj` is the pure-logic core extracted from [Soma](https://github.com/drkostas/soma)'s live DJ daemon: given a runner's live heart rate, it computes the target music BPM for that effort, and given a candidate pool of songs it produces a session-aware shuffle that spreads same-artist songs evenly without clustering.

No I/O, no database, no network. Just math and state transitions — so the same logic works in a Garmin-driven treadmill session, a Spotify playlist builder, or anything else that wants "pick the right tempo for this pulse."

## What it computes

### BPM formula
- **Piecewise anchors** between 0% HRR (75 BPM) and 100% HRR (175 BPM), linearly interpolated.
- **Quantized to 5-BPM steps** — below Weber's-law JND for tempo perception.
- Floor 70, ceiling 185.
- Research basis: Karageorghis et al. (2009, 2011) on HR-preference scaling; CADENCE-Adults (Bravata et al.) on piecewise HR-cadence.

### Session shuffle
- Tracks `played`, `skipped`, and `last_played_artist_id` per session.
- Partitions candidates by artist, then interleaves to maximize artist diversity.
- Feels more random to humans than Fisher-Yates because it prevents the birthday-paradox clustering effect.

## Install

The same pure core is also published to npm (source in [`typescript/`](typescript/)) so it can run
in the browser, Node, or a Vercel cron alongside Soma's TypeScript stack. The
The Python original this was ported from was removed on 2026-09-11 (git history keeps it); the npm package is the product. Its tests carry the Python-parity goldens.

```bash
npm install run-dj
```

```ts
import { hrrToBpm, SessionState, interleavedShuffle, selectSongsForSegment } from "run-dj";

const bpm = hrrToBpm(125, 60, 190); // → 128
const state = new SessionState();
const ordered = interleavedShuffle(candidateSongs, state);
```

The TS package also exposes the segment-based playlist scorer (`bpmQuality`,
`qualityScore`, `selectSongsForSegment`). Both packages are covered by tests in CI
(pytest for Python, vitest for TypeScript).

## License

MIT.
