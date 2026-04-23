"""run-dj — HR → music BPM mapping + session shuffle engine.

Pure-logic core extracted from Soma's live DJ daemon. No I/O, no network,
no database. Just math and state transitions.
"""

from run_dj.bpm_formula import BPM_CEILING, BPM_FLOOR, hrr_to_bpm, latest_hr_from_garmin_data
from run_dj.shuffle import SessionState, interleaved_shuffle

__version__ = "0.1.0"

__all__ = [
    "BPM_CEILING",
    "BPM_FLOOR",
    "SessionState",
    "hrr_to_bpm",
    "interleaved_shuffle",
    "latest_hr_from_garmin_data",
]
