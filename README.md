# run-dj

HR → music BPM mapping + session shuffle engine.

`run-dj` is the pure-logic core extracted from [Soma](https://github.com/drkostas/soma)'s live DJ daemon: given a runner's live heart rate, it computes the target music BPM for that effort, and given a candidate pool of songs it produces a session-aware shuffle that spreads same-artist songs evenly without clustering.

No I/O, no database, no network. Just math and state transitions — so the same logic works in a Garmin-driven treadmill session, a Spotify playlist builder, or anything else that wants "pick the right tempo for this pulse."

## Install

```bash
pip install run-dj
```

## Usage

```python
from run_dj import hrr_to_bpm, SessionState, interleaved_shuffle

# HR → BPM using Karvonen %HRR (piecewise anchors + JND quantization).
bpm = hrr_to_bpm(hr=150, hr_rest=60, hr_max=190)
# → 132

# Session-aware shuffle that avoids same-artist clustering.
state = SessionState()
ordered = interleaved_shuffle(candidate_songs, state)
```

### BPM formula
- **Piecewise anchors** between 0% HRR (75 BPM) and 100% HRR (175 BPM), linearly interpolated.
- **Quantized to 5-BPM steps** — below Weber's-law JND for tempo perception.
- Floor 70, ceiling 185.
- Research basis: Karageorghis et al. (2009, 2011) on HR-preference scaling; CADENCE-Adults (Bravata et al.) on piecewise HR-cadence.

### Session shuffle
- Tracks `played`, `skipped`, and `last_played_artist_id` per session.
- Partitions candidates by artist, then interleaves to maximize artist diversity.
- Feels more random to humans than Fisher-Yates because it prevents the birthday-paradox clustering effect.

## License

MIT.
