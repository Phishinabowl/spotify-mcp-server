import assert from 'node:assert/strict';
import test from 'node:test';
import { connect, mockConfig, mockHttp, resultText } from './helpers.js';

test('structured playback state retains exact device, context, item and action data', async (t) => {
  mockConfig(t);
  mockHttp(t, [
    {
      url: 'me/player?additional_types=episode',
      response: {
        device: {
          id: 'desktop',
          is_active: true,
          is_restricted: false,
          href: 'extra',
        },
        is_playing: false,
        progress_ms: 12345,
        context: { uri: 'spotify:album:album1', type: 'album' },
        item: {
          id: 'track1',
          uri: 'spotify:track:track1',
          type: 'track',
          duration_ms: 180000,
        },
        actions: { disallows: { seeking: false } },
      },
    },
  ]);
  const client = await connect(t);
  const state = JSON.parse(
    resultText(
      await client.callTool({ name: 'getPlaybackState', arguments: {} }),
    ),
  );
  assert.equal(state.device.id, 'desktop');
  assert.equal(state.device.href, undefined);
  assert.equal(state.progressMs, 12345);
  assert.equal(state.context.uri, 'spotify:album:album1');
  assert.equal(state.actions.disallows.seeking, false);
});

test('transfer refuses an unavailable device and reports accepted versus observed transfer', async (t) => {
  mockConfig(t);
  mockHttp(t, [
    { url: 'me/player/devices', response: { devices: [{ id: 'desktop' }] } },
    { url: 'me/player/devices', response: { devices: [{ id: 'desktop' }] } },
    {
      url: 'me/player',
      method: 'PUT',
      body: { device_ids: ['desktop'], play: false },
    },
    {
      url: 'me/player?additional_types=episode',
      response: { device: { id: 'other' } },
    },
  ]);
  const client = await connect(t);
  const missing = await client.callTool({
    name: 'transferPlayback',
    arguments: { deviceId: 'missing' },
  });
  assert.equal(missing.isError, true);
  const accepted = JSON.parse(
    resultText(
      await client.callTool({
        name: 'transferPlayback',
        arguments: { deviceId: 'desktop' },
      }),
    ),
  );
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.transferObserved, false);
});

test('repeat and shuffle target active device and distinguish stale observations', async (t) => {
  mockConfig(t);
  mockHttp(t, [
    {
      url: 'me/player?additional_types=episode',
      response: { device: { id: 'desktop' } },
    },
    { url: 'me/player/repeat?state=track&device_id=desktop', method: 'PUT' },
    {
      url: 'me/player?additional_types=episode',
      response: { device: { id: 'desktop' }, repeat_state: 'off' },
    },
    {
      url: 'me/player?additional_types=episode',
      response: { device: { id: 'desktop' } },
    },
    { url: 'me/player/shuffle?state=false&device_id=desktop', method: 'PUT' },
    {
      url: 'me/player?additional_types=episode',
      response: { device: { id: 'desktop' }, shuffle_state: false },
    },
  ]);
  const client = await connect(t);
  const repeat = JSON.parse(
    resultText(
      await client.callTool({
        name: 'setRepeatMode',
        arguments: { deviceId: 'desktop', state: 'track' },
      }),
    ),
  );
  assert.equal(repeat.accepted, true);
  assert.equal(repeat.repeatObserved, false);
  const shuffle = JSON.parse(
    resultText(
      await client.callTool({
        name: 'setShuffle',
        arguments: { deviceId: 'desktop', enabled: false },
      }),
    ),
  );
  assert.equal(shuffle.shuffleObserved, true);
});

test('track lookup and cursor-based recent history preserve identifiers and context', async (t) => {
  mockConfig(t);
  mockHttp(t, [
    {
      url: 'tracks/track1',
      response: {
        id: 'track1',
        uri: 'spotify:track:track1',
        name: 'Song',
        duration_ms: 100000,
        artists: [{ id: 'artist1', name: 'Artist', href: 'extra' }],
        album: {
          id: 'album1',
          uri: 'spotify:album:album1',
          name: 'Album',
          album_type: 'album',
          images: [{ url: 'extra' }],
        },
        external_ids: { isrc: 'ISRC1' },
      },
    },
    {
      url: 'me/player/recently-played?limit=2&after=123',
      response: {
        items: [
          {
            played_at: '2026-10-23T10:00:00Z',
            track: { id: 'track1', uri: 'spotify:track:track1', name: 'Song' },
            context: { uri: 'spotify:album:album1' },
          },
        ],
        cursors: { after: '456' },
        next: 'next-page',
      },
    },
  ]);
  const client = await connect(t);
  const track = JSON.parse(
    resultText(
      await client.callTool({
        name: 'getTrack',
        arguments: { trackId: 'track1' },
      }),
    ),
  );
  assert.equal(track.album.id, 'album1');
  assert.equal(track.album.images, undefined);
  assert.equal(track.artists[0].href, undefined);
  assert.equal(track.isrc, 'ISRC1');
  const history = JSON.parse(
    resultText(
      await client.callTool({
        name: 'getRecentlyPlayedPage',
        arguments: { limit: 2, after: 123 },
      }),
    ),
  );
  assert.equal(history.items[0].context.uri, 'spotify:album:album1');
  assert.equal(history.cursors.after, '456');
  assert.equal(history.hasNext, true);
  const both = await client.callTool({
    name: 'getRecentlyPlayedPage',
    arguments: { after: 1, before: 2 },
  });
  assert.equal(both.isError, true);
});

test('bounded state wait reports delayed match without assuming command acceptance', async (t) => {
  mockConfig(t);
  mockHttp(t, [
    {
      url: 'me/player?additional_types=episode',
      response: {
        device: { id: 'desktop' },
        item: { uri: 'spotify:track:old' },
        is_playing: false,
      },
    },
    {
      url: 'me/player?additional_types=episode',
      response: {
        device: { id: 'desktop' },
        item: { uri: 'spotify:track:new' },
        is_playing: true,
        progress_ms: 500,
      },
    },
  ]);
  const client = await connect(t);
  const outcome = JSON.parse(
    resultText(
      await client.callTool({
        name: 'waitForPlaybackState',
        arguments: {
          deviceId: 'desktop',
          itemUri: 'spotify:track:new',
          isPlaying: true,
          timeoutMs: 1000,
        },
      }),
    ),
  );
  assert.equal(outcome.matched, true);
  assert.equal(outcome.attempts, 2);
});

test('state wait rejects an impossible progress range without sending a request', async (t) => {
  mockHttp(t, []);
  const client = await connect(t);
  const result = await client.callTool({
    name: 'waitForPlaybackState',
    arguments: {
      deviceId: 'desktop',
      minProgressMs: 60000,
      maxProgressMs: 30000,
    },
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /minProgressMs/);
});
