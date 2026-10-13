import crypto from 'node:crypto';
import http from 'node:http';
import { z } from 'zod';
import { renderCallbackPage } from './callback-page.js';
import { defineTool } from './tool.js';

const redirect = 'http://127.0.0.1:8765/callback';
let access: string | undefined;
let refresh: string | undefined;
let expires = 0;
let granted = new Set<string>();
let server: http.Server | undefined;
let timer: NodeJS.Timeout | undefined;
let phase = 'idle';
let refreshPending: Promise<void> | undefined;
let generation = 0;
let discardCachedClient: (() => void) | undefined;
export function onSessionClosed(hook: () => void) {
  discardCachedClient = hook;
}
export const sessionAuthEnabled = () =>
  process.env.SPOTIFY_SESSION_AUTH === 'pkce';
export const pkceChallenge = (verifier: string) =>
  crypto.createHash('sha256').update(verifier).digest('base64url');

function clientId() {
  const id = process.env.SPOTIFY_CLIENT_ID ?? '';
  if (!/^[a-f0-9]{32}$/i.test(id))
    throw new Error('Set the public SPOTIFY_CLIENT_ID');
  return id;
}

async function exchange(fields: Record<string, string>) {
  const started = generation;
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...fields, client_id: clientId() }),
  });
  if (!response.ok)
    throw new Error(`Token exchange rejected (HTTP ${response.status})`);
  const token = await response.json();
  if (started !== generation) throw new Error('Session was closed');
  if (
    typeof token.access_token !== 'string' ||
    token.token_type?.toLowerCase() !== 'bearer'
  )
    throw new Error('Invalid token response');
  access = token.access_token;
  refresh = token.refresh_token ?? refresh;
  expires = Date.now() + Number(token.expires_in ?? 3600) * 1000;
  if (typeof token.scope === 'string')
    granted = new Set(token.scope.split(' '));
}

function stopCallback() {
  clearTimeout(timer);
  timer = undefined;
  server?.close();
  server = undefined;
}

export function closeSession() {
  generation++;
  discardCachedClient?.();
  stopCallback();
  access = refresh = undefined;
  expires = 0;
  granted.clear();
  phase = 'idle';
}

export async function sessionToken() {
  if (!access)
    throw new Error(
      'Call beginSpotifyAuthorization and complete browser consent first',
    );
  if (Date.now() >= expires - 30000) {
    if (!refresh) throw new Error('Session expired; authorize again');
    refreshPending ??= exchange({
      grant_type: 'refresh_token',
      refresh_token: refresh,
    }).finally(() => {
      refreshPending = undefined;
    });
    await refreshPending;
  }
  return access;
}

export function requireSessionScopes(scopes: string[]) {
  if (sessionAuthEnabled() && scopes.some((scope) => !granted.has(scope)))
    throw new Error('Required Spotify scope was not granted; authorize again');
}

export async function beginAuthorization(scopes: readonly string[]) {
  const id = clientId();
  if (phase === 'waiting' || phase === 'exchanging')
    throw new Error('Authorization already pending');
  closeSession();
  const started = generation;
  const verifier = crypto.randomBytes(48).toString('base64url');
  const state = crypto.randomBytes(32).toString('base64url');
  let consumed = false;
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', redirect);
    if (url.pathname !== '/callback' || req.headers.host !== '127.0.0.1:8765') {
      res.writeHead(404).end();
      return;
    }
    const states = url.searchParams.getAll('state');
    const codes = url.searchParams.getAll('code');
    const validState = states.length === 1 && states[0] === state;
    const accepted =
      validState &&
      !url.searchParams.has('error') &&
      codes.length === 1 &&
      Boolean(codes[0]) &&
      !consumed;
    res.writeHead(accepted ? 200 : 400, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(renderCallbackPage(accepted));
    if (validState && url.searchParams.has('error')) {
      phase = 'denied';
      stopCallback();
    }
    if (!accepted) return;
    consumed = true;
    phase = 'exchanging';
    stopCallback();
    void exchange({
      grant_type: 'authorization_code',
      code: codes[0],
      redirect_uri: redirect,
      code_verifier: verifier,
    })
      .then(() => {
        if (started === generation) phase = 'ready';
      })
      .catch(() => {
        if (started === generation) {
          access = refresh = undefined;
          granted.clear();
          phase = 'failed';
        }
      });
  });
  const callbackServer = server;
  try {
    await new Promise<void>((resolve, reject) => {
      callbackServer.once('error', reject);
      callbackServer.listen(8765, '127.0.0.1', resolve);
    });
  } catch {
    closeSession();
    throw new Error('Could not bind Spotify callback port 8765');
  }
  phase = 'waiting';
  timer = setTimeout(() => {
    phase = 'expired';
    stopCallback();
  }, 600000);
  const query = new URLSearchParams({
    client_id: id,
    response_type: 'code',
    redirect_uri: redirect,
    scope: scopes.join(' '),
    state,
    code_challenge_method: 'S256',
    code_challenge: pkceChallenge(verifier),
  });
  return {
    authorizationUrl: `https://accounts.spotify.com/authorize?${query}`,
    scopes,
    expiresInSeconds: 600,
  };
}

export function authorizationTools(scopes: readonly string[]) {
  return [
    defineTool({
      name: 'beginSpotifyAuthorization',
      description:
        'Begin memory-only Spotify PKCE consent. Return the link for the owner to open manually; never opens a browser.',
      schema: {},
      handler: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify(await beginAuthorization(scopes)),
          },
        ],
      }),
    }),
    defineTool({
      name: 'getSpotifyAuthorizationStatus',
      description:
        'Read authorization status and granted scopes without exposing credentials.',
      schema: {},
      handler: () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ phase, scopes: [...granted] }),
          },
        ],
      }),
    }),
    defineTool({
      name: 'closeSpotifySession',
      description:
        'Discard session credentials and close a pending callback listener.',
      schema: { confirm: z.literal(true) },
      handler: () => {
        closeSession();
        return { content: [{ type: 'text', text: 'Session closed' }] };
      },
    }),
  ];
}
