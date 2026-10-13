import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

test('PKCE stdio startup discovers 34 tools and serves status without consent or credential files', async (t) => {
  const client = new Client({ name: 'pkce-smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../build/index.js', import.meta.url))],
    env: {
      ...process.env,
      SPOTIFY_SESSION_AUTH: 'pkce',
      SPOTIFY_REQUIRE_DEVICE: 'true',
      SPOTIFY_CLIENT_ID: '0'.repeat(32),
    },
  });
  t.after(() => client.close());
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 34);
  const status = await client.callTool({
    name: 'getSpotifyAuthorizationStatus',
    arguments: {},
  });
  assert.deepEqual(JSON.parse(status.content[0].text), {
    phase: 'idle',
    scopes: [],
  });
  const pause = await client.callTool({ name: 'pausePlayback', arguments: {} });
  assert.equal(pause.isError, true);
  await client.callTool({
    name: 'closeSpotifySession',
    arguments: { confirm: true },
  });
});
