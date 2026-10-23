import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { defineTool, spotifyId } from './tool.js';
import { spotifyFetch } from './utils.js';

type PlaybackState = {
  device?: {
    id?: string;
    name?: string;
    type?: string;
    is_active?: boolean;
    is_restricted?: boolean;
    volume_percent?: number | null;
  };
  is_playing?: boolean;
  progress_ms?: number | null;
  timestamp?: number;
  repeat_state?: string;
  shuffle_state?: boolean;
  context?: { uri?: string; type?: string } | null;
  currently_playing_type?: string;
  item?: {
    id?: string;
    uri?: string;
    type?: string;
    name?: string;
    duration_ms?: number;
    album?: { id?: string; name?: string };
    artists?: Array<{ id?: string; name?: string }>;
    restrictions?: { reason?: string };
    is_playable?: boolean;
  } | null;
  actions?: { disallows?: Record<string, boolean> };
};

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function failure(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: error instanceof Error ? error.message : String(error),
      },
    ],
  };
}

async function playbackState(): Promise<PlaybackState | null> {
  return spotifyFetch<PlaybackState | null>('me/player', {
    query: { additional_types: 'episode' },
  });
}

function summarize(state: PlaybackState | null) {
  if (!state) return { hasState: false };
  return {
    hasState: true,
    timestamp: state.timestamp,
    device: state.device
      ? {
          id: state.device.id,
          name: state.device.name,
          type: state.device.type,
          isActive: state.device.is_active,
          isRestricted: state.device.is_restricted,
          volumePercent: state.device.volume_percent,
        }
      : null,
    isPlaying: state.is_playing,
    progressMs: state.progress_ms,
    repeatState: state.repeat_state,
    shuffleState: state.shuffle_state,
    context: state.context
      ? { uri: state.context.uri, type: state.context.type }
      : null,
    currentlyPlayingType: state.currently_playing_type,
    item: state.item
      ? {
          id: state.item.id,
          uri: state.item.uri,
          type: state.item.type,
          name: state.item.name,
          durationMs: state.item.duration_ms,
          album: state.item.album
            ? { id: state.item.album.id, name: state.item.album.name }
            : undefined,
          artists: state.item.artists?.map((artist) => ({
            id: artist.id,
            name: artist.name,
          })),
          restrictions: state.item.restrictions,
          isPlayable: state.item.is_playable,
        }
      : null,
    actions: state.actions,
  };
}

async function requireActiveDevice(deviceId: string) {
  const state = await playbackState();
  if (state?.device?.id !== deviceId)
    throw new Error(
      'Selected device is not the active playback device; transfer playback first',
    );
  if (state.device.is_restricted)
    throw new Error('Selected device is restricted from Web API control');
}

const getPlaybackState = defineTool({
  name: 'getPlaybackState',
  description:
    'Read structured playback state, including exact progress, context, device, repeat/shuffle and available actions.',
  schema: {},
  handler: async () => {
    try {
      return result(summarize(await playbackState()));
    } catch (error) {
      return failure(error);
    }
  },
});

const waitForPlaybackState = defineTool({
  name: 'waitForPlaybackState',
  description:
    'Poll briefly for a matching device, item, play state or progress range after a player command; returns observed state or a bounded timeout.',
  schema: {
    deviceId: z.string().min(1).describe('Expected active device ID'),
    itemUri: z.string().optional().describe('Expected track or episode URI'),
    isPlaying: z.boolean().optional().describe('Expected playing/paused state'),
    minProgressMs: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Minimum observed progress in milliseconds'),
    maxProgressMs: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Maximum observed progress in milliseconds'),
    timeoutMs: z
      .number()
      .int()
      .min(250)
      .max(10000)
      .optional()
      .describe('Maximum wait in milliseconds (default 5000, max 10000)'),
  },
  handler: async ({
    deviceId,
    itemUri,
    isPlaying,
    minProgressMs,
    maxProgressMs,
    timeoutMs = 5000,
  }) => {
    try {
      if (
        minProgressMs !== undefined &&
        maxProgressMs !== undefined &&
        minProgressMs > maxProgressMs
      )
        throw new Error('minProgressMs must not exceed maxProgressMs');
      const deadline = Date.now() + timeoutMs;
      let attempts = 0;
      let state: PlaybackState | null = null;
      do {
        state = await playbackState();
        attempts++;
        const matched =
          state?.device?.id === deviceId &&
          (itemUri === undefined || state.item?.uri === itemUri) &&
          (isPlaying === undefined || state.is_playing === isPlaying) &&
          (minProgressMs === undefined ||
            (typeof state.progress_ms === 'number' &&
              state.progress_ms >= minProgressMs)) &&
          (maxProgressMs === undefined ||
            (typeof state.progress_ms === 'number' &&
              state.progress_ms <= maxProgressMs));
        if (matched)
          return result({ matched: true, attempts, state: summarize(state) });
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await delay(Math.min(250, remaining));
      } while (Date.now() <= deadline);
      return result({ matched: false, attempts, state: summarize(state) });
    } catch (error) {
      return failure(error);
    }
  },
});

const transferPlayback = defineTool({
  name: 'transferPlayback',
  description:
    'Transfer playback to one explicitly discovered Spotify Connect device and optionally start playing.',
  schema: {
    deviceId: z
      .string()
      .min(1)
      .describe('Destination device ID from getAvailableDevices'),
    play: z
      .boolean()
      .optional()
      .describe(
        'Start playback after transfer (default false, preserving paused/playing state)',
      ),
  },
  handler: async ({ deviceId, play = false }) => {
    try {
      const available = await spotifyFetch<{
        devices: Array<{ id?: string; is_restricted?: boolean }>;
      }>('me/player/devices');
      const target = available.devices.find((device) => device.id === deviceId);
      if (!target)
        throw new Error('Destination device is not currently available');
      if (target.is_restricted)
        throw new Error(
          'Destination device is restricted from Web API control',
        );
      await spotifyFetch('me/player', {
        method: 'PUT',
        body: { device_ids: [deviceId], play },
      });
      const observed = await playbackState();
      return result({
        accepted: true,
        transferObserved: observed?.device?.id === deviceId,
        requested: { deviceId, play },
        observed: summarize(observed),
      });
    } catch (error) {
      return failure(error);
    }
  },
});

const setRepeatMode = defineTool({
  name: 'setRepeatMode',
  description:
    'Set repeat to off, track or context on an explicitly selected active device.',
  schema: {
    deviceId: z.string().min(1),
    state: z.enum(['off', 'track', 'context']),
  },
  handler: async ({ deviceId, state }) => {
    try {
      await requireActiveDevice(deviceId);
      await spotifyFetch('me/player/repeat', {
        method: 'PUT',
        query: { state, device_id: deviceId },
      });
      const observed = await playbackState();
      return result({
        accepted: true,
        repeatObserved:
          observed?.device?.id === deviceId && observed.repeat_state === state,
        requested: { deviceId, state },
        observed: summarize(observed),
      });
    } catch (error) {
      return failure(error);
    }
  },
});

const setShuffle = defineTool({
  name: 'setShuffle',
  description: 'Set shuffle on or off on an explicitly selected active device.',
  schema: {
    deviceId: z.string().min(1),
    enabled: z.boolean(),
  },
  handler: async ({ deviceId, enabled }) => {
    try {
      await requireActiveDevice(deviceId);
      await spotifyFetch('me/player/shuffle', {
        method: 'PUT',
        query: { state: String(enabled), device_id: deviceId },
      });
      const observed = await playbackState();
      return result({
        accepted: true,
        shuffleObserved:
          observed?.device?.id === deviceId &&
          observed.shuffle_state === enabled,
        requested: { deviceId, enabled },
        observed: summarize(observed),
      });
    } catch (error) {
      return failure(error);
    }
  },
});

const getTrack = defineTool({
  name: 'getTrack',
  description:
    'Get public catalog metadata for one track ID, including album, duration, artists and availability.',
  schema: { trackId: spotifyId },
  handler: async ({ trackId }) => {
    try {
      const track = await spotifyFetch<{
        id: string;
        uri: string;
        name: string;
        duration_ms: number;
        artists: Array<{ id: string; name: string }>;
        album: { id: string; uri: string; name: string; album_type: string };
        disc_number?: number;
        track_number?: number;
        explicit?: boolean;
        is_playable?: boolean;
        restrictions?: { reason?: string };
        external_ids?: { isrc?: string };
      }>(`tracks/${trackId}`);
      return result({
        id: track.id,
        uri: track.uri,
        name: track.name,
        durationMs: track.duration_ms,
        artists: track.artists.map((artist) => ({
          id: artist.id,
          name: artist.name,
        })),
        album: {
          id: track.album.id,
          uri: track.album.uri,
          name: track.album.name,
          type: track.album.album_type,
        },
        discNumber: track.disc_number,
        trackNumber: track.track_number,
        explicit: track.explicit,
        isPlayable: track.is_playable,
        restrictions: track.restrictions,
        isrc: track.external_ids?.isrc,
      });
    } catch (error) {
      return failure(error);
    }
  },
});

const getRecentlyPlayedPage = defineTool({
  name: 'getRecentlyPlayedPage',
  description:
    'Read recently played tracks with an optional after/before Unix-millisecond cursor and return Spotify pagination cursors.',
  schema: {
    limit: z.number().int().min(1).max(50).optional(),
    after: z.number().int().nonnegative().optional(),
    before: z.number().int().nonnegative().optional(),
  },
  handler: async ({ limit = 20, after, before }) => {
    try {
      if (after !== undefined && before !== undefined)
        throw new Error('Choose after or before, not both');
      const page = await spotifyFetch<{
        items: Array<{
          played_at: string;
          track?: {
            id?: string;
            uri?: string;
            name?: string;
            duration_ms?: number;
            album?: { id?: string; name?: string };
            artists?: Array<{ name?: string }>;
          };
          context?: { uri?: string; type?: string } | null;
        }>;
        cursors?: { after?: string; before?: string };
        next?: string | null;
      }>('me/player/recently-played', { query: { limit, after, before } });
      return result({
        items: page.items.map((entry) => ({
          playedAt: entry.played_at,
          track: entry.track
            ? {
                id: entry.track.id,
                uri: entry.track.uri,
                name: entry.track.name,
                durationMs: entry.track.duration_ms,
                album: entry.track.album
                  ? {
                      id: entry.track.album.id,
                      name: entry.track.album.name,
                    }
                  : undefined,
                artists: entry.track.artists?.map((artist) => artist.name),
              }
            : null,
          context: entry.context
            ? { uri: entry.context.uri, type: entry.context.type }
            : null,
        })),
        cursors: page.cursors,
        hasNext: Boolean(page.next),
      });
    } catch (error) {
      return failure(error);
    }
  },
});

export const playbackExtraTools = [
  getPlaybackState,
  waitForPlaybackState,
  transferPlayback,
  setRepeatMode,
  setShuffle,
  getTrack,
  getRecentlyPlayedPage,
];
