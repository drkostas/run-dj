/**
 * The segments of a run that a playlist is built against.
 *
 * A run is a list of items: a segment (warm-up, easy, tempo, intervals and so on, each with a BPM and
 * valence range) or a repeat group (a template of segments played several times). Parsed workout steps
 * become items here, and `segsForGenerate` decides which segments share one pool of songs.
 *
 * Ids come from the caller (`makeId`), so an app can use its own id scheme.
 */
export const SEGMENT_TYPES = [
  "warmup", "easy", "aerobic", "tempo", "interval",
  "vo2max", "recovery", "rest", "strides", "cooldown",
] as const;
export type SegmentType = (typeof SEGMENT_TYPES)[number];

export interface Segment {
  id: string; type: SegmentType; duration_s: number;
  bpm_min: number; bpm_max: number; bpm_tolerance: number;
  sync_mode: "sync" | "async" | "auto";
  valence_min: number; valence_max: number;
}
export interface RepeatGroup {
  id: string;
  type: "repeat";
  repeat_count: number;
  /** Steps in one iteration. */
  template_size: number;
  /** Every iteration, repeat_count x template_size. */
  children: Segment[];
}
export type SegmentItem = Segment | RepeatGroup;
export type ParsedStep =
  | { type?: string; duration_s?: number }
  | { type: "repeat"; repeat_count: number; children: ParsedStep[] };

/** BPM and valence range per segment type. */
export const BPM_DEFAULTS: Record<SegmentType, { min: number; max: number; valence_min: number; valence_max: number }> = {
  warmup: { min: 100, max: 140, valence_min: 0.3, valence_max: 0.7 },
  easy: { min: 125, max: 145, valence_min: 0.3, valence_max: 0.7 },
  aerobic: { min: 125, max: 145, valence_min: 0.3, valence_max: 0.7 },
  tempo: { min: 160, max: 180, valence_min: 0.1, valence_max: 0.5 },
  interval: { min: 175, max: 195, valence_min: 0.0, valence_max: 0.4 },
  vo2max: { min: 175, max: 195, valence_min: 0.0, valence_max: 0.4 },
  recovery: { min: 125, max: 145, valence_min: 0.3, valence_max: 0.7 },
  rest: { min: 80, max: 110, valence_min: 0.3, valence_max: 0.7 },
  strides: { min: 160, max: 180, valence_min: 0.1, valence_max: 0.5 },
  cooldown: { min: 60, max: 90, valence_min: 0.6, valence_max: 1.0 },
};

/** A step longer than this makes a repeat group "long": its step types are pooled across iterations. */
export const SHORT_STEP_MAX_S = 120;

let seq = 0;
/** The default id: unique within a process, no dependency. */
export const defaultSegmentId = (): string =>
  `s${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A segment for one parsed step. A type outside SEGMENT_TYPES becomes "easy", so every segment has a known range. */
export function makeSegment(p: { type?: string; duration_s?: number }, makeId: () => string = defaultSegmentId): Segment {
  const type = (p.type && p.type in BPM_DEFAULTS ? p.type : "easy") as SegmentType;
  const bpm = BPM_DEFAULTS[type];
  return {
    id: makeId(), type, duration_s: p.duration_s ?? 600, bpm_min: bpm.min, bpm_max: bpm.max,
    bpm_tolerance: 8, sync_mode: "auto", valence_min: bpm.valence_min, valence_max: bpm.valence_max,
  };
}

/** Parsed workout steps to items. A nested repeat inside a repeat is dropped from the template. */
export function parsedToItems(parsed: ParsedStep[], makeId: () => string = defaultSegmentId): SegmentItem[] {
  return parsed.map((p) => {
    if ((p as { type?: string }).type === "repeat" && "children" in p) {
      const repeatCount = (p as { repeat_count: number }).repeat_count ?? 1;
      const templateSegs = (p as { children: ParsedStep[] }).children
        .filter((c) => (c as { type?: string }).type !== "repeat")
        .map((c) => makeSegment(c as { type?: string; duration_s?: number }, makeId));
      if (!templateSegs.length) return makeSegment({ type: "easy", duration_s: 600 }, makeId);
      const children: Segment[] = [];
      for (let i = 0; i < repeatCount; i++) for (const seg of templateSegs) children.push(i === 0 ? seg : { ...seg, id: makeId() });
      return { id: makeId(), type: "repeat" as const, repeat_count: repeatCount, template_size: templateSegs.length, children };
    }
    return makeSegment(p as { type?: string; duration_s?: number }, makeId);
  });
}

/** Every segment in play order, repeat groups expanded. */
export function flatItems(items: SegmentItem[]): Segment[] {
  return items.flatMap((item) => (item.type === "repeat" ? item.children : [item]));
}

/**
 * The segments to generate songs for, and which flat segments each one fills.
 *
 * A repeat group whose steps are all short (strides, drills) becomes one block for its whole length,
 * at its main step's range. A long one pools each step type across its iterations, so 5 x [interval,
 * recovery] gives one interval pool and one recovery pool. A plain segment is one to one.
 * `flatIndexMap[i]` lists the positions in `flatItems(items)` that segment i fills.
 */
export function segsForGenerate(items: SegmentItem[], makeId: () => string = defaultSegmentId): { segments: Segment[]; flatIndexMap: number[][] } {
  const segments: Segment[] = [];
  const flatIndexMap: number[][] = [];
  let flatIdx = 0;
  for (const item of items) {
    if (item.type === "repeat") {
      const template = item.children.slice(0, item.template_size);
      if (template.every((s) => s.duration_s <= SHORT_STEP_MAX_S)) {
        const dominant = template.find((s) => s.type !== "recovery" && s.type !== "rest") ?? template[0];
        const total = item.children.reduce((s, c) => s + c.duration_s, 0);
        segments.push({ ...dominant, id: makeId(), duration_s: total });
        flatIndexMap.push(Array.from({ length: item.children.length }, (_, i) => flatIdx + i));
      } else {
        for (let t = 0; t < template.length; t++) {
          segments.push({ ...template[t], id: makeId(), duration_s: template[t].duration_s * item.repeat_count });
          const indices: number[] = [];
          for (let r = 0; r < item.repeat_count; r++) indices.push(flatIdx + r * item.template_size + t);
          flatIndexMap.push(indices);
        }
      }
      flatIdx += item.children.length;
    } else {
      segments.push(item);
      flatIndexMap.push([flatIdx]);
      flatIdx++;
    }
  }
  return { segments, flatIndexMap };
}
