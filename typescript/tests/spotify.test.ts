import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSpotifyClient, SPOTIFY_SCOPES, type SpotifyTokenStore } from "../src/spotify";

const T0 = 1_700_000_000_000;
function memStore(initial: Record<string, unknown> | null): SpotifyTokenStore & { saved: unknown[]; creds: Record<string, unknown> | null } {
  const s = {
    creds: initial, saved: [] as unknown[],
    load: vi.fn(async () => s.creds as never),
    save: vi.fn(async (patch: unknown) => { s.saved.push(patch); s.creds = { ...(s.creds ?? {}), ...(patch as object) }; }),
  };
  return s;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const inAnHour = new Date(T0 + 3_600_000).toISOString();

let clock = T0;
beforeEach(() => { clock = T0; });

describe("createSpotifyClient", () => {
  it("exposes the scope string the auth flow needs", () => {
    expect(SPOTIFY_SCOPES).toContain("user-modify-playback-state");
  });

  it("uses the stored token when valid and caches it (one store read for many calls)", async () => {
    const store = memStore({ access_token: "A", refresh_token: "R", expires_at: inAnHour });
    const fetchImpl = vi.fn(async () => json({ ok: 1 })) as unknown as typeof fetch;
    const c = createSpotifyClient({ clientId: "cid", store, fetchImpl, now: () => clock });
    await c.spotifyFetch("/me/player"); await c.spotifyFetch("/me/player"); await c.getAccessToken();
    expect(store.load).toHaveBeenCalledTimes(1);
    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer A");
    expect((fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]).toBe("https://api.spotify.com/v1/me/player");
  });

  it("refreshes through accounts.spotify.com when the stored token is about to expire, and saves the result", async () => {
    const store = memStore({ access_token: "OLD", refresh_token: "R", expires_at: new Date(T0 + 30_000).toISOString() });
    const fetchImpl = vi.fn(async (url: string) => url.includes("accounts.spotify.com") ? json({ access_token: "NEW", expires_in: 3600, refresh_token: "R2" }) : json({ ok: 1 })) as unknown as typeof fetch;
    const c = createSpotifyClient({ clientId: "cid", store, fetchImpl, now: () => clock });
    expect(await c.getAccessToken()).toBe("NEW");
    expect(store.saved).toEqual([{ access_token: "NEW", expires_at: new Date(T0 + 3_600_000).toISOString(), refresh_token: "R2" }]);
    const body = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token"); expect(body.get("client_id")).toBe("cid");
  });

  it("falls back to the store's own expiry column when expires_at is absent", async () => {
    const store = memStore({ access_token: "A", refresh_token: "R", db_expires_at: new Date(T0 + 3_600_000) });
    const fetchImpl = vi.fn(async () => json({})) as unknown as typeof fetch;
    const c = createSpotifyClient({ clientId: "cid", store, fetchImpl, now: () => clock });
    expect(await c.getAccessToken()).toBe("A");
  });

  it("retries once on 401 with a refreshed token", async () => {
    const store = memStore({ access_token: "A", refresh_token: "R", expires_at: inAnHour });
    let apiCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("accounts.spotify.com")) return json({ access_token: "B", expires_in: 3600 });
      apiCalls++; return apiCalls === 1 ? new Response("", { status: 401 }) : json({ fine: true });
    }) as unknown as typeof fetch;
    const c = createSpotifyClient({ clientId: "cid", store, fetchImpl, now: () => clock });
    const res = await c.spotifyFetch("/me");
    expect(res.status).toBe(200);
    const calls = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect((calls[2][1].headers as Record<string, string>).Authorization).toBe("Bearer B");
    expect(await c.getAccessToken()).toBe("B"); // the refreshed token is now cached
  });

  it("not connected: isConnected false, getProfile null, token calls throw", async () => {
    const store = memStore(null);
    const c = createSpotifyClient({ clientId: "cid", store, fetchImpl: vi.fn() as unknown as typeof fetch, now: () => clock });
    expect(await c.isConnected()).toBe(false);
    expect(await c.getProfile()).toBeNull();
    await expect(c.getAccessToken()).rejects.toThrow("Spotify not connected");
  });

  it("getProfile prefers the stored identity and only then asks /me", async () => {
    const stored = memStore({ access_token: "A", refresh_token: "R", expires_at: inAnHour, spotify_user_id: "u1", display_name: "Kostas" });
    const fetchImpl = vi.fn(async () => json({ id: "api", display_name: "From API" })) as unknown as typeof fetch;
    expect(await createSpotifyClient({ clientId: "cid", store: stored, fetchImpl, now: () => clock }).getProfile()).toEqual({ id: "u1", display_name: "Kostas" });
    expect(fetchImpl).not.toHaveBeenCalled();
    const bare = memStore({ access_token: "A", refresh_token: "R", expires_at: inAnHour });
    expect(await createSpotifyClient({ clientId: "cid", store: bare, fetchImpl, now: () => clock }).getProfile()).toEqual({ id: "api", display_name: "From API" });
  });

  it("a failed refresh surfaces as an error", async () => {
    const store = memStore({ access_token: "OLD", refresh_token: "R", expires_at: new Date(T0).toISOString() });
    const fetchImpl = vi.fn(async () => new Response("", { status: 400 })) as unknown as typeof fetch;
    await expect(createSpotifyClient({ clientId: "cid", store, fetchImpl, now: () => clock }).getAccessToken()).rejects.toThrow("refresh failed: 400");
  });
});
