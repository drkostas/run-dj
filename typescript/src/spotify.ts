/**
 * Spotify Web API client for the DJ: bearer calls with a cached token,
 * refresh through accounts.spotify.com when the token is about to expire,
 * one retry on 401. WHERE the tokens live is the consumer's business: it
 * supplies a `SpotifyTokenStore` (soma keeps them in a platform_credentials
 * row). `fetch` and the clock are injectable for tests.
 */

export const SPOTIFY_SCOPES =
  "user-library-read playlist-read-private playlist-modify-private user-modify-playback-state user-read-playback-state streaming";

export interface SpotifyCredentials {
  access_token: string;
  refresh_token: string;
  /** ISO timestamp of the access token's expiry, as Spotify reported it. */
  expires_at?: string | null;
  display_name?: string | null;
  spotify_user_id?: string | null;
}

export interface SpotifyTokenStore {
  /** The stored credentials, or null when Spotify is not connected. `db_expires_at` is the store's own expiry column, used when `expires_at` is absent. */
  load(): Promise<(SpotifyCredentials & { db_expires_at?: Date | string | null }) | null>;
  /** Persist a refreshed token (and the new refresh token when Spotify rotates it). */
  save(patch: { access_token: string; expires_at: string; refresh_token?: string }): Promise<void>;
}

export interface SpotifyClientOptions {
  clientId: string;
  store: SpotifyTokenStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
  apiBase?: string;
  accountsTokenUrl?: string;
}

export interface SpotifyClient {
  /** A call against the Web API (`path` is appended to /v1), authenticated, with one retry on 401. */
  spotifyFetch(path: string, init?: RequestInit): Promise<Response>;
  /** A valid access token, refreshed if needed. */
  getAccessToken(): Promise<string>;
  isConnected(): Promise<boolean>;
  getProfile(): Promise<{ id: string; display_name: string } | null>;
  /** Drop the cached token (tests, or after the store changed underneath). */
  resetCache(): void;
}

const REFRESH_MARGIN_MS = 60_000;
const ASSUMED_LIFETIME_MS = 3_540_000; // 59 minutes: Spotify tokens live an hour

export function createSpotifyClient(options: SpotifyClientOptions): SpotifyClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const apiBase = options.apiBase ?? "https://api.spotify.com/v1";
  const tokenUrl = options.accountsTokenUrl ?? "https://accounts.spotify.com/api/token";
  const { clientId, store } = options;

  // One cache per client: avoids a store read on every call during bulk work.
  let cache: { access_token: string; refresh_token: string; expires_at: number } | null = null;

  async function doRefresh(refreshToken: string): Promise<string> {
    const res = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
    });
    if (!res.ok) throw new Error(`Spotify token refresh failed: ${res.status}`);
    const data = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
    const expiresAt = new Date(now() + data.expires_in * 1000).toISOString();
    await store.save({ access_token: data.access_token, expires_at: expiresAt, ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}) });
    return data.access_token;
  }

  async function getToken(): Promise<{ access_token: string; refresh_token: string }> {
    if (cache && cache.expires_at - now() > REFRESH_MARGIN_MS) return cache;
    const creds = await store.load();
    if (!creds) throw new Error("Spotify not connected");
    const expiresAt = creds.expires_at ? new Date(creds.expires_at).getTime() : creds.db_expires_at ? new Date(creds.db_expires_at).getTime() : 0;
    if (expiresAt - now() < REFRESH_MARGIN_MS) {
      const access = await doRefresh(creds.refresh_token);
      cache = { access_token: access, refresh_token: creds.refresh_token, expires_at: now() + ASSUMED_LIFETIME_MS };
    } else {
      cache = { access_token: creds.access_token, refresh_token: creds.refresh_token, expires_at: expiresAt };
    }
    return cache;
  }

  function withAuth(token: string, init: RequestInit): RequestInit {
    return { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...((init.headers as Record<string, string>) ?? {}) } };
  }

  return {
    async spotifyFetch(path, init = {}) {
      const { access_token, refresh_token } = await getToken();
      const res = await fetchImpl(`${apiBase}${path}`, withAuth(access_token, init));
      if (res.status !== 401) return res;
      // Token invalidated mid-request: refresh once and retry.
      cache = null;
      const fresh = await doRefresh(refresh_token);
      cache = { access_token: fresh, refresh_token, expires_at: now() + ASSUMED_LIFETIME_MS };
      return fetchImpl(`${apiBase}${path}`, withAuth(fresh, init));
    },
    async getAccessToken() {
      return (await getToken()).access_token;
    },
    async isConnected() {
      return (await store.load()) !== null;
    },
    async getProfile() {
      const creds = await store.load();
      if (!creds) return null;
      if (creds.spotify_user_id && creds.display_name) return { id: creds.spotify_user_id, display_name: creds.display_name };
      try {
        const res = await this.spotifyFetch("/me");
        if (!res.ok) return null;
        const data = (await res.json()) as { id: string; display_name: string };
        return { id: data.id, display_name: data.display_name };
      } catch {
        return null;
      }
    },
    resetCache() {
      cache = null;
    },
  };
}
