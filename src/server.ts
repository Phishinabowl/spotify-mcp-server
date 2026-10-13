import { McpServer } from '@modelcontextprotocol/server';
import { albumTools } from './albums.js';
import { playTools } from './play.js';
import { playlistTools } from './playlist.js';
import { readTools } from './read.js';
import { authorizationTools, sessionAuthEnabled } from './session-auth.js';
import { SPOTIFY_SCOPES } from './utils.js';

export function createServer() {
  const server = new McpServer({
    name: 'spotify-controller',
    version: '1.0.0',
  });

  [
    ...readTools,
    ...playTools,
    ...albumTools,
    ...playlistTools,
    ...(sessionAuthEnabled() ? authorizationTools(SPOTIFY_SCOPES) : []),
  ].forEach((tool) => {
    tool.register(server);
  });

  return server;
}
