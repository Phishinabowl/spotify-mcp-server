import type {
  CallToolResult,
  McpServer,
  ServerContext,
} from '@modelcontextprotocol/server';
import { z } from 'zod';

// Spotify IDs are base62. Some are interpolated straight into API paths, so
// reject anything that could change the path or query (`/`, `.`, `?`, `#`, `%`).
export const spotifyId = z
  .string()
  .regex(/^[A-Za-z0-9]+$/, 'Must be a Spotify ID (letters and digits only)');

// Keep each handler paired with its inferred schema when registering mixed tools.
export function defineTool<Args extends z.ZodRawShape>(definition: {
  name: string;
  description: string;
  schema: Args;
  handler: (
    args: z.output<z.ZodObject<Args>>,
    context: ServerContext,
  ) => Promise<CallToolResult> | CallToolResult;
}) {
  return {
    ...definition,
    register(server: McpServer) {
      server.registerTool(
        definition.name,
        {
          description: definition.description,
          inputSchema: z.object(definition.schema),
        },
        (args, context) => {
          if (
            process.env.SPOTIFY_REQUIRE_DEVICE === 'true' &&
            [
              'playMusic',
              'pausePlayback',
              'resumePlayback',
              'skipToNext',
              'skipToPrevious',
              'seekToPosition',
              'transferPlayback',
              'setRepeatMode',
              'setShuffle',
              'addToQueue',
              'setVolume',
              'adjustVolume',
            ].includes(definition.name)
          ) {
            const input = args as Record<string, unknown>;
            if (
              !(
                typeof (input.deviceId ?? input.device_id) === 'string' &&
                String(input.deviceId ?? input.device_id).length > 0
              )
            ) {
              return {
                isError: true,
                content: [
                  {
                    type: 'text',
                    text: 'An explicit deviceId is required; discover devices first',
                  },
                ],
              };
            }
          }
          return definition.handler(args, context);
        },
      );
    },
  };
}
