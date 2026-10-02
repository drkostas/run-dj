# Changelog

## 0.6.1

- The npm package has a README (the npm page was empty), including the 0.6.0 additions.

## 0.6.0

- `segments` (also at `run-dj/segments`): the segment model a run playlist is built against, moved from the soma web and app, which each had a copy. Segment types and their BPM and valence ranges, parsed steps to segments and repeat groups, and which segments share a pool of songs (`segsForGenerate`). Ids come from the caller. A step with an unknown type becomes an easy segment.

## 0.5.0

Earlier releases have no changelog.
