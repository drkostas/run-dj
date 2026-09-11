import { describe, it, expect, vi } from "vitest";
import { fetchAudioFeatures } from "../src/reccobeats";

const item = (id: string, tempo: number) => ({ id: `uuid-${id}`, href: `https://api.reccobeats.com/v1/track/${id}`, tempo, energy: 0.5, valence: 0.5, danceability: 0.5, key: 1, mode: 1 });
const ok = (content: unknown[]) => new Response(JSON.stringify({ content }), { status: 200 });

describe("fetchAudioFeatures", () => {
  it("keys results by the Spotify id taken from href, not ReccoBeats' uuid", async () => {
    const fetchImpl = vi.fn(async () => ok([item("sp1", 120), item("sp2", 128)])) as unknown as typeof fetch;
    const m = await fetchAudioFeatures(["sp1", "sp2"], { fetchImpl, sleep: async () => {} });
    expect([...m.keys()]).toEqual(["sp1", "sp2"]);
    expect(m.get("sp2")?.tempo).toBe(128);
  });
  it("batches at 40 ids and pauses between batches", async () => {
    const calls: string[] = []; const sleeps: number[] = [];
    const fetchImpl = vi.fn(async (url: string) => { calls.push(url); return ok([]); }) as unknown as typeof fetch;
    const ids = Array.from({ length: 95 }, (_, i) => `t${i}`);
    await fetchAudioFeatures(ids, { fetchImpl, sleep: async (ms) => { sleeps.push(ms); } });
    expect(calls.length).toBe(3);
    expect(calls[0].split("ids=")[1].split(",").length).toBe(40);
    expect(calls[2].split("ids=")[1].split(",").length).toBe(15);
    expect(sleeps).toEqual([300, 300]);
  });
  it("retries a 429 twice honouring Retry-After, then gives the batch up", async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi.fn(async () => new Response("", { status: 429, headers: { "Retry-After": "2" } })) as unknown as typeof fetch;
    const m = await fetchAudioFeatures(["a"], { fetchImpl, sleep: async (ms) => { sleeps.push(ms); } });
    expect(m.size).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([2000, 2000]);
  });
  it("a non-OK response yields no features, no throw", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    expect((await fetchAudioFeatures(["a"], { fetchImpl, sleep: async () => {} })).size).toBe(0);
  });
  it("no ids → no request", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect((await fetchAudioFeatures([], { fetchImpl })).size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
