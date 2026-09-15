import { Scope, AppSetting } from '@aws-blocks/blocks';

export const scope = new Scope('sample-mad-l');

// ---------------------------------------------------------------------------
// AppSettings
// ---------------------------------------------------------------------------

/**
 * GAME_SERVER_URL: the default upstream game-server base URL.
 * Marked secret because a non-secret AppSetting requires a non-empty `value`
 * and there is no sensible static default for this URL.
 */
export const gameServerUrlSetting = new AppSetting(scope, 'game-server-url', {
  secret: true,
});

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type Credentials = {
  token: string;
  gameServerUrl: string;
  playerKey: string;
  displayName: string;
};

export type UpstreamError = {
  ok?: false;
  error?: string;
};

export type UpstreamPlayer = {
  playerId: string;
  displayName: string;
  mode: string;
  deployed: boolean;
};

export type UpstreamRoundPart = {
  kind: 'text' | 'blank';
  text?: string | null;
  index?: number | null;
  hint?: string | null;
  example?: string | null;
  word?: string | null;
  by?: string | null;
  filler?: boolean | null;
};

export type UpstreamRound = {
  roundId: string;
  seq: number;
  phase: 'lobby' | 'collecting' | 'results';
  title: string;
  endsAt: number | null;
  blankCount: number;
  parts: UpstreamRoundPart[];
};

export type UpstreamHello = {
  ok: boolean;
  now?: number;
  player?: UpstreamPlayer;
  round?: UpstreamRound | null;
  you?: {
    blankIndex: number | null;
    hint: string | null;
    example: string | null;
    word: string | null;
    submitted: boolean;
  };
  stats?: {
    players: number;
    active: number;
    deployed: number;
    local: number;
  };
  error?: string;
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const UPSTREAM_TIMEOUT_MS = 6000;
const PLACEHOLDER = '<PASTE_GAME_SERVER_URL_HERE>';

const runningDeployed = !!(
  process.env['REPLIT_DEPLOYMENT'] ?? process.env['AWS_LAMBDA_FUNCTION_NAME']
);
const deployedRegion =
  process.env['AWS_REGION'] ?? (process.env['REPLIT_DEPLOYMENT'] ? 'replit' : '');

export async function configuredGameServerUrl(): Promise<string> {
  const raw = ((await gameServerUrlSetting.get()) ?? '').trim();
  if (!raw || raw === PLACEHOLDER) return '';
  return normalizeGameServerUrl(raw) ?? '';
}

export function normalizeGameServerUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function credentialsFrom(data: {
  token: string;
  displayName: string;
  playerKey: string;
  gameServerUrl: string;
}): Credentials | null {
  const gameServerUrl = normalizeGameServerUrl(data.gameServerUrl);
  if (!gameServerUrl) return null;
  return {
    token: data.token,
    displayName: data.displayName,
    playerKey: data.playerKey,
    gameServerUrl,
  };
}

export function helloPayload(credentials: Credentials, origin: string) {
  return {
    token: credentials.token,
    playerKey: credentials.playerKey,
    displayName: credentials.displayName,
    origin,
    mode: runningDeployed ? 'aws' : 'local',
    region: deployedRegion,
  };
}

export async function upstreamFetch(
  url: string,
  init: RequestInit = {},
): Promise<{ response: Response | null; data: unknown | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...((init.headers as Record<string, string>) ?? {}),
      },
    });
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return { response, data };
  } catch {
    return { response: null, data: null };
  } finally {
    clearTimeout(timeout);
  }
}

export function upstreamErrorText(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const error = (data as UpstreamError).error;
  return typeof error === 'string' && error ? error : null;
}

export function upstreamStatus(response: Response | null): number {
  if (!response) return 502;
  if (response.status === 401) return 502;
  if (response.status >= 400 && response.status < 500) return response.status;
  return 502;
}

export function requestOrigin(headers: Headers): string {
  const forwardedHost =
    headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost';
  const forwardedProto = headers.get('x-forwarded-proto') ?? 'https';
  return `${forwardedProto}://${forwardedHost}`;
}
