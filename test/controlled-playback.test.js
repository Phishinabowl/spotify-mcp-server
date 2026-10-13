import assert from 'node:assert/strict';
import test from 'node:test';
import { renderCallbackPage } from '../build/callback-page.js';
import {
  beginAuthorization,
  closeSession,
  pkceChallenge,
  sessionToken,
} from '../build/session-auth.js';
import { connect, mockConfig, mockHttp } from './helpers.js';

test('explicit unknown device never falls back or writes playback', async (t) => {
  mockConfig(t);
  mockHttp(t, [
    {
      url: 'me/player/devices',
      response: { devices: [{ id: 'other', is_active: true }] },
    },
  ]);
  const client = await connect(t);
  const result = await client.callTool({
    name: 'playMusic',
    arguments: { deviceId: 'missing', uri: 'spotify:track:track1' },
  });
  assert.match(result.content[0].text, /no fallback/);
});

test('accepted request with wrong observed track is not reported as verified', async (t) => {
  mockConfig(t);
  mockHttp(t, [
    {
      url: 'me/player/devices',
      response: { devices: [{ id: 'desktop', is_active: true }] },
    },
    {
      url: 'me/player/play?device_id=desktop',
      method: 'PUT',
      body: {
        context_uri: 'spotify:playlist:example',
        offset: { uri: 'spotify:track:' + 'A'.repeat(22) },
        position_ms: 0,
      },
    },
    {
      url: 'me/player',
      response: {
        device: { id: 'desktop' },
        is_playing: true,
        item: { uri: 'spotify:track:wrong' },
      },
    },
  ]);
  const client = await connect(t);
  const result = await client.callTool({
    name: 'playMusic',
    arguments: {
      deviceId: 'desktop',
      context_uri: 'spotify:playlist:example',
      offsetUri: 'spotify:track:' + 'A'.repeat(22),
      positionMs: 0,
    },
  });
  assert.equal(JSON.parse(result.content[0].text).playbackObserved, false);
});

test('strict mode refuses untargeted controls before network calls', async (t) => {
  const previous = process.env.SPOTIFY_REQUIRE_DEVICE;
  process.env.SPOTIFY_REQUIRE_DEVICE = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.SPOTIFY_REQUIRE_DEVICE;
    else process.env.SPOTIFY_REQUIRE_DEVICE = previous;
  });
  mockHttp(t, []);
  const client = await connect(t);
  for (const name of ['pausePlayback', 'resumePlayback', 'skipToNext']) {
    const result = await client.callTool({ name, arguments: {} });
    assert.equal(result.isError, true);
  }
});

test('PKCE vector and failed callback never exchange credentials', async (t) => {
  assert.equal(
    pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
  process.env.SPOTIFY_CLIENT_ID = '0'.repeat(32);
  t.after(() => {
    closeSession();
    delete process.env.SPOTIFY_CLIENT_ID;
  });
  const auth = await beginAuthorization(['user-read-playback-state']);
  assert.equal(
    new URL(auth.authorizationUrl).searchParams.get('code_challenge_method'),
    'S256',
  );
  const response = await fetch(
    'http://127.0.0.1:8765/callback?state=wrong&code=test-only',
  );
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(!(await response.text()).includes('test-only'));
  await assert.rejects(sessionToken(), /consent/);
  assert.match(renderCallbackPage(true), /window.close/);
  assert.ok(!renderCallbackPage(false).includes('window.close'));
});

test('valid callback exchanges once, keeps tokens out of HTML and discards credentials on close', async (t) => {
  process.env.SPOTIFY_CLIENT_ID = '0'.repeat(32);
  t.after(() => {
    closeSession();
    delete process.env.SPOTIFY_CLIENT_ID;
  });
  const realFetch = globalThis.fetch;
  let exchanges = 0;
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    if (String(input) === 'https://accounts.spotify.com/api/token') {
      exchanges++;
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(
        new URLSearchParams(options.body).get('grant_type'),
        'authorization_code',
      );
      return Response.json({
        access_token: 'test-access-only',
        refresh_token: 'test-refresh-only',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'user-read-playback-state',
      });
    }
    return realFetch(input, options);
  });
  const auth = await beginAuthorization(['user-read-playback-state']);
  const state = new URL(auth.authorizationUrl).searchParams.get('state');
  const response = await fetch(
    'http://127.0.0.1:8765/callback?state=' + state + '&code=test-code-only',
  );
  assert.equal(response.status, 200);
  assert.doesNotMatch(
    await response.text(),
    /test-access-only|test-refresh-only|test-code-only/,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(await sessionToken(), 'test-access-only');
  assert.equal(exchanges, 1);
  closeSession();
  await assert.rejects(sessionToken(), /consent/);
});
