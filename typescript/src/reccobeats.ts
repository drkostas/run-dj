/**
 * ReccoBeats audio-features client: tempo, energy, valence, danceability, key
 * and mode per Spotify track id. Batches of 40 (the service silently returns
 * nothing for larger batches), a short pause between batches, and up to two
 * retries on 429 honouring Retry-After. `fetch` and `sleep` are injectable so
 * a test never touches the network.
 */

export interface ReccoBeatsFeatures {
  id: string; // Spotify track ID
  tempo: number; // BPM
  energy: number; // 0.0 to 1.0
  valence: number; // 0.0 to 1.0
  danceability: number;
  key: number;
  mode: number;
}

export interface ReccoBeatsOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Max ids per request. Default 40, the service's real limit. */
  batchSize?: number;
  /** Pause between batches in ms. Default 300. */
  pauseMs?: number;
  baseUrl?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchBatch(ids: string[], o: Required<ReccoBeatsOptions>, attempt = 0): Promise<ReccoBeatsFeatures[]> {
  if (ids.length === 0) return [];
  const res = await o.fetchImpl(`${o.baseUrl}/v1/audio-features?ids=${ids.join(",")}`, { cache: "no-store" } as RequestInit);

  if (res.status === 429) {
    if (attempt < 2) {
      const retryAfter = parseInt(res.headers.get("Retry-After") ?? "5", 10);
      await o.sleep(retryAfter * 1000);
      return fetchBatch(ids, o, attempt + 1);
    }
    return [];
  }
  if (!res.ok) return [];

  const data = (await res.json()) as { content?: Array<Record<string, unknown>> };
  // Each item's href carries the Spotify track id; the item's own id is ReccoBeats' UUID.
  return (data?.content ?? []).map((item) => ({
    ...(item as unknown as ReccoBeatsFeatures),
    id: String(item.href ?? "").split("/track/")[1] ?? String(item.id),
  }));
}

/** Audio features for any number of Spotify track ids, keyed by id. Missing ids are simply absent. */
export async function fetchAudioFeatures(ids: string[], options: ReccoBeatsOptions = {}): Promise<Map<string, ReccoBeatsFeatures>> {
  const o: Required<ReccoBeatsOptions> = {
    fetchImpl: options.fetchImpl ?? fetch,
    sleep: options.sleep ?? defaultSleep,
    batchSize: options.batchSize ?? 40,
    pauseMs: options.pauseMs ?? 300,
    baseUrl: options.baseUrl ?? "https://api.reccobeats.com",
  };
  const result = new Map<string, ReccoBeatsFeatures>();
  for (let i = 0; i < ids.length; i += o.batchSize) {
    const batch = ids.slice(i, i + o.batchSize);
    for (const f of await fetchBatch(batch, o)) result.set(f.id, f);
    if (i + o.batchSize < ids.length) await o.sleep(o.pauseMs);
  }
  return result;
}
