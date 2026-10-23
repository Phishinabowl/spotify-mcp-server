import assert from 'node:assert/strict';
import test from 'node:test';
import { withSpotifyRequestToken } from '../build/request-context.js';
import { createSpotifyApi, spotifyFetch } from '../build/utils.js';

const token = (name, fn) => withSpotifyRequestToken(`test-${name}`, fn);
const opaque = () =>
  new Response('opaque-command-ack', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

test('SDK pause, queue and skip accept successful opaque acknowledgements', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(input, init);
    requests.push([new URL(request.url).pathname, request.method]);
    return opaque();
  });
  await token('sdk-commands', async () => {
    const api = await createSpotifyApi();
    await api.player.pausePlayback('desktop');
    await api.player.addItemToPlaybackQueue('spotify:track:test', 'desktop');
    await api.player.skipToNext('desktop');
  });
  assert.deepEqual(requests, [
    ['/v1/me/player/pause', 'PUT'],
    ['/v1/me/player/queue', 'POST'],
    ['/v1/me/player/next', 'POST'],
  ]);
});

test('direct playback command accepts opaque JSON-labelled acknowledgement', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => opaque());
  assert.equal(
    await token('direct-command', () =>
      spotifyFetch('me/player/play', {
        method: 'PUT',
        body: { uris: ['spotify:track:test'] },
      }),
    ),
    undefined,
  );
});

test('SDK rejected command remains an error', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          error: { status: 401, message: 'Invalid access token' },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  await assert.rejects(
    token('rejected-command', async () =>
      (await createSpotifyApi()).player.pausePlayback('desktop'),
    ),
  );
});

test('malformed player GET response still fails JSON parsing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => opaque());
  await assert.rejects(
    token('malformed-read', async () =>
      (await createSpotifyApi()).player.getPlaybackState(),
    ),
    SyntaxError,
  );
});

test('JSON-producing playlist mutation retains its response', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('{"id":"new-playlist"}', {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  assert.deepEqual(
    await token('playlist-create', () =>
      spotifyFetch('users/test/playlists', {
        method: 'POST',
        body: { name: 'test' },
      }),
    ),
    { id: 'new-playlist' },
  );
});
