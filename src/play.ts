import { z } from 'zod';
import { defineTool, spotifyId } from './tool.js';
import type { SpotifyHandlerExtra } from './types.js';
import { handleSpotifyRequest, spotifyFetch } from './utils.js';

/**
 * Ensures there is an active Spotify device before attempting playback.
 * Requires the explicitly selected device; never falls back to another device.
 */
async function ensureActiveDevice(preferredDeviceId?: string): Promise<string> {
  if (!preferredDeviceId)
    throw new Error('An explicit deviceId is required; discover devices first');
  const data = await spotifyFetch<{
    devices: Array<{ id: string; is_active: boolean; name: string }>;
  }>('me/player/devices');
  const devices = data?.devices ?? [];

  if (devices.length === 0) {
    throw new Error(
      'No Spotify devices found. Open Spotify on any device first.',
    );
  }

  // If a preferred device was specified and exists, use it
  if (preferredDeviceId) {
    const preferred = devices.find((d) => d.id === preferredDeviceId);
    if (preferred) {
      if (!preferred.is_active) {
        await spotifyFetch('me/player', {
          method: 'PUT',
          body: { device_ids: [preferredDeviceId], play: false },
        });
        await new Promise((r) => setTimeout(r, 500));
      }
      return preferredDeviceId;
    }
  }

  throw new Error(
    'Requested Spotify device was not found; no fallback was selected',
  );
}

const playMusic = defineTool({
  name: 'playMusic',
  description:
    'Start playing a Spotify track, album, artist, or playlist. ' +
    'Pass a Spotify URI (e.g. spotify:track:xxx, spotify:album:xxx) via "uri". ' +
    'For albums/playlists you can also use "context_uri". ' +
    'An explicit "deviceId" or "device_id" is required. Reports acceptance and observed state separately.',
  schema: {
    uri: z
      .string()
      .optional()
      .describe(
        'Spotify URI to play (e.g. spotify:track:xxx, spotify:album:xxx)',
      ),
    context_uri: z
      .string()
      .optional()
      .describe('Alias for uri — Spotify context URI for albums/playlists'),
    type: z
      .enum(['track', 'album', 'artist', 'playlist'])
      .optional()
      .describe('Type of item (only needed with id)'),
    id: z
      .string()
      .optional()
      .describe('Spotify ID of the item (use with type)'),
    deviceId: z
      .string()
      .optional()
      .describe('Spotify device ID to play on (required; discover devices first)'),
    device_id: z.string().optional().describe('Alias for deviceId'),
    offset: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Track offset within album/playlist (0-based)'),
    offsetUri: z
      .string()
      .optional()
      .describe(
        'Track URI within an album/playlist; cannot accompany numeric offset',
      ),
    positionMs: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Start position in milliseconds'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    // Normalize aliases
    const deviceId = args.deviceId ?? args.device_id;
    const resolvedUri = args.uri ?? args.context_uri;
    const { type, id, offset } = args;

    if (!(resolvedUri || (type && id))) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Must provide a "uri" (e.g. spotify:track:xxx) or both "type" and "id"',
            isError: true,
          },
        ],
      };
    }

    let spotifyUri = resolvedUri;
    if (!spotifyUri && type && id) {
      spotifyUri = `spotify:${type}:${id}`;
    }

    // Infer type from URI if not provided
    const resolvedType = type ?? spotifyUri?.split(':')?.[1];

    try {
      const activeDeviceId = await ensureActiveDevice(deviceId);
      if (offset !== undefined && args.offsetUri !== undefined)
        throw new Error('Choose offset or offsetUri');
      if (
        resolvedType === 'track' &&
        (offset !== undefined || args.offsetUri !== undefined)
      )
        throw new Error('Track offsets require an album/playlist context');
      if (
        args.offsetUri &&
        !/^spotify:track:[A-Za-z0-9]{22}$/.test(args.offsetUri)
      )
        throw new Error('Invalid offsetUri');
      const body = {
        ...(resolvedType === 'track'
          ? { uris: [spotifyUri] }
          : { context_uri: spotifyUri }),
        ...(offset !== undefined ? { offset: { position: offset } } : {}),
        ...(args.offsetUri ? { offset: { uri: args.offsetUri } } : {}),
        ...(args.positionMs !== undefined
          ? { position_ms: args.positionMs }
          : {}),
      };
      await spotifyFetch('me/player/play', {
        method: 'PUT',
        query: { device_id: activeDeviceId },
        body,
      });
      const observed = await spotifyFetch<{
        device?: { id: string };
        is_playing?: boolean;
        progress_ms?: number;
        item?: { uri: string };
      }>('me/player');
      const matches =
        observed?.device?.id === activeDeviceId &&
        observed.is_playing === true &&
        Boolean(observed.item?.uri) &&
        (resolvedType !== 'track' || observed.item?.uri === spotifyUri) &&
        (!args.offsetUri || observed.item?.uri === args.offsetUri);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              accepted: true,
              playbackObserved: matches,
              requestedUri: spotifyUri,
              observed: {
                deviceId: observed?.device?.id,
                uri: observed?.item?.uri,
                isPlaying: observed?.is_playing,
                progressMs: observed?.progress_ms,
              },
            }),
          },
        ],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: 'text', text: `Error playing music: ${msg}`, isError: true },
        ],
      };
    }
  },
});

const pausePlayback = defineTool({
  name: 'pausePlayback',
  description: 'Pause Spotify playback on the active device',
  schema: {
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to pause playback on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { deviceId } = args;

    await handleSpotifyRequest(async (spotifyApi) => {
      await spotifyApi.player.pausePlayback(deviceId || '');
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Playback paused',
        },
      ],
    };
  },
});

const skipToNext = defineTool({
  name: 'skipToNext',
  description: 'Skip to the next track in the current Spotify playback queue',
  schema: {
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to skip on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { deviceId } = args;

    await handleSpotifyRequest(async (spotifyApi) => {
      await spotifyApi.player.skipToNext(deviceId || '');
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Skipped to next track',
        },
      ],
    };
  },
});

const skipToPrevious = defineTool({
  name: 'skipToPrevious',
  description:
    'Skip to the previous track in the current Spotify playback queue',
  schema: {
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to skip on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { deviceId } = args;

    await handleSpotifyRequest(async (spotifyApi) => {
      await spotifyApi.player.skipToPrevious(deviceId || '');
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Skipped to previous track',
        },
      ],
    };
  },
});

const seekToPosition = defineTool({
  name: 'seekToPosition',
  description:
    'Seek within the track or episode currently loaded on an explicitly selected Spotify device. ' +
    'Use an absolute position in milliseconds; reports command acceptance and observed playback state separately.',
  schema: {
    deviceId: z
      .string()
      .min(1)
      .describe('Spotify device ID to seek on; discover devices first'),
    positionMs: z
      .number()
      .int()
      .positive()
      .describe('Absolute position from the start in milliseconds (at least 1)'),
  },
  handler: async ({ deviceId, positionMs }, _extra: SpotifyHandlerExtra) => {
    try {
      const before = await spotifyFetch<{
        device?: { id?: string };
        item?: { uri?: string; duration_ms?: number };
      }>('me/player');
      if (before?.device?.id !== deviceId)
        throw new Error('Selected device is not the active playback device');
      const uri = before.item?.uri;
      if (!uri) throw new Error('No track or episode is loaded on the selected device');
      const durationMs = before.item?.duration_ms;
      if (typeof durationMs === 'number' && positionMs >= durationMs)
        throw new Error('Position must be before the end of the loaded item');

      await spotifyFetch('me/player/seek', {
        method: 'PUT',
        query: { position_ms: positionMs, device_id: deviceId },
      });
      const observed = await spotifyFetch<{
        device?: { id?: string };
        item?: { uri?: string };
        progress_ms?: number;
        is_playing?: boolean;
      }>('me/player');
      const sameItem =
        observed?.device?.id === deviceId && observed.item?.uri === uri;
      const positionObserved =
        sameItem &&
        typeof observed?.progress_ms === 'number' &&
        Math.abs(observed.progress_ms - positionMs) <= 5000;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            accepted: true,
            positionObserved,
            requested: { deviceId, uri, positionMs },
            observed: {
              deviceId: observed?.device?.id,
              uri: observed?.item?.uri,
              progressMs: observed?.progress_ms,
              isPlaying: observed?.is_playing,
            },
          }),
        }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: `Error seeking playback: ${error instanceof Error ? error.message : String(error)}`,
        }],
      };
    }
  },
});

const createPlaylist = defineTool({
  name: 'createPlaylist',
  description: 'Create a new playlist on Spotify',
  schema: {
    name: z.string().describe('The name of the playlist'),
    description: z
      .string()
      .optional()
      .describe('The description of the playlist'),
    public: z
      .boolean()
      .optional()
      .describe('Whether the playlist should be public'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { name, description, public: isPublic = false } = args;

    try {
      // Hit /me/playlists directly: the /users/{id}/playlists path the SDK's
      // createPlaylist() uses was retired in the March 2026 API migration for
      // Development Mode apps (see spotifyFetch JSDoc). POST /me/playlists
      // infers the owner from the token, so no profile lookup is needed.
      const result = await spotifyFetch<{
        id: string;
        external_urls: { spotify: string };
      }>('me/playlists', {
        method: 'POST',
        body: { name, description, public: isPublic },
      });

      return {
        content: [
          {
            type: 'text',
            text: `Successfully created playlist "${name}"\nPlaylist ID: ${result.id}\nPlaylist URL: ${result.external_urls.spotify}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error creating playlist: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
});

const addTracksToPlaylist = defineTool({
  name: 'addTracksToPlaylist',
  description:
    'Add tracks or podcast episodes to a Spotify playlist. ' +
    'Accepts Spotify track IDs, episode IDs, or full Spotify URIs (e.g. spotify:episode:xxx).',
  schema: {
    playlistId: spotifyId.describe('The Spotify ID of the playlist'),
    trackIds: z
      .array(z.string())
      .describe(
        'Array of Spotify IDs or URIs to add. ' +
          'Plain IDs are assumed to be tracks. ' +
          'To add podcast episodes, pass full URIs: spotify:episode:{id}.',
      ),
    position: z
      .number()
      .nonnegative()
      .optional()
      .describe('Position to insert the items (0-based index)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { playlistId, trackIds, position } = args;

    if (trackIds.length === 0) {
      return {
        content: [{ type: 'text', text: 'Error: No IDs provided' }],
      };
    }

    try {
      const uris = trackIds.map((id) =>
        id.startsWith('spotify:') ? id : `spotify:track:${id}`,
      );

      // Hit /items directly: see spotifyFetch JSDoc for context.
      await spotifyFetch(`playlists/${playlistId}/items`, {
        method: 'POST',
        body: {
          uris,
          ...(position !== undefined ? { position } : {}),
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: `Successfully added ${trackIds.length} item${
              trackIds.length === 1 ? '' : 's'
            } to playlist (ID: ${playlistId})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error adding items to playlist: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
});

const resumePlayback = defineTool({
  name: 'resumePlayback',
  description: 'Resume Spotify playback on the active device',
  schema: {
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to resume playback on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { deviceId } = args;

    try {
      const activeDeviceId = await ensureActiveDevice(deviceId);
      await handleSpotifyRequest(async (spotifyApi) => {
        await spotifyApi.player.startResumePlayback(activeDeviceId);
      });
      return { content: [{ type: 'text', text: 'Playback resumed' }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error resuming playback: ${msg}`,
            isError: true,
          },
        ],
      };
    }
  },
});

const addToQueue = defineTool({
  name: 'addToQueue',
  description: 'Adds a track, album, artist or playlist to the playback queue',
  schema: {
    uri: z
      .string()
      .optional()
      .describe('The Spotify URI to play (overrides type and id)'),
    type: z
      .enum(['track', 'album', 'artist', 'playlist'])
      .optional()
      .describe('The type of item to play'),
    id: z.string().optional().describe('The Spotify ID of the item to play'),
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to add the track to'),
  },
  handler: async (args) => {
    const { uri, type, id, deviceId } = args;

    let spotifyUri = uri;
    if (!spotifyUri && type && id) {
      spotifyUri = `spotify:${type}:${id}`;
    }

    if (!spotifyUri) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Must provide either a URI or both a type and ID',
            isError: true,
          },
        ],
      };
    }

    await handleSpotifyRequest(async (spotifyApi) => {
      await spotifyApi.player.addItemToPlaybackQueue(
        spotifyUri,
        deviceId || '',
      );
    });

    return {
      content: [
        {
          type: 'text',
          text: `Added item ${spotifyUri} to queue`,
        },
      ],
    };
  },
});

const setVolume = defineTool({
  name: 'setVolume',
  description:
    'Set the playback volume to a specific percentage (0-100). Requires Spotify Premium.',
  schema: {
    volumePercent: z
      .number()
      .min(0)
      .max(100)
      .describe('The volume to set (0-100)'),
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to set volume on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { volumePercent, deviceId } = args;

    try {
      await handleSpotifyRequest(async (spotifyApi) => {
        await spotifyApi.player.setPlaybackVolume(
          Math.round(volumePercent),
          deviceId || '',
        );
      });

      return {
        content: [
          {
            type: 'text',
            text: `Volume set to ${Math.round(volumePercent)}%`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error setting volume: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
});

const adjustVolume = defineTool({
  name: 'adjustVolume',
  description:
    'Adjust the playback volume up or down by a relative amount. Use positive values to increase, negative to decrease. Requires Spotify Premium.',
  schema: {
    adjustment: z
      .number()
      .min(-100)
      .max(100)
      .describe(
        'The amount to adjust volume by (-100 to 100). Positive increases, negative decreases.',
      ),
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to adjust volume on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { adjustment, deviceId } = args;

    try {
      // First get the current playback state to find current volume
      const playback = await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.player.getPlaybackState();
      });

      if (!playback?.device) {
        return {
          content: [
            {
              type: 'text',
              text: 'No active device found. Make sure Spotify is open and playing on a device.',
            },
          ],
        };
      }

      const currentVolume = playback.device.volume_percent;
      if (currentVolume === null || currentVolume === undefined) {
        return {
          content: [
            {
              type: 'text',
              text: 'Unable to get current volume from device.',
            },
          ],
        };
      }

      const newVolume = Math.min(100, Math.max(0, currentVolume + adjustment));

      await handleSpotifyRequest(async (spotifyApi) => {
        await spotifyApi.player.setPlaybackVolume(
          Math.round(newVolume),
          deviceId || '',
        );
      });

      const direction = adjustment > 0 ? 'increased' : 'decreased';
      return {
        content: [
          {
            type: 'text',
            text: `Volume ${direction} from ${currentVolume}% to ${Math.round(newVolume)}%`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error adjusting volume: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
});

export const playTools = [
  playMusic,
  pausePlayback,
  skipToNext,
  skipToPrevious,
  seekToPosition,
  createPlaylist,
  addTracksToPlaylist,
  resumePlayback,
  addToQueue,
  setVolume,
  adjustVolume,
];
