<div align="center" style="display: flex; align-items: center; justify-content: center; gap: 10px;">
<img src="https://upload.wikimedia.org/wikipedia/commons/8/84/Spotify_icon.svg" width="30" height="30">
<h1>Spotify MCP Server</h1>
</div>

A lightweight [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that enables AI assistants like Cursor & Claude to control Spotify playback and manage playlists.

This [fork](https://github.com/Phishinabowl/spotify-mcp-server) adds local, session-only PKCE authorization; explicit-device playback controls; structured playback observations; and track/history lookup. It is based on [Marcel Marais's server](https://github.com/marcelmarais/spotify-mcp-server). Existing file-backed and HTTP OAuth flows remain available. See [ADAPTATIONS.md](ADAPTATIONS.md) for implementation and verification details.

<details>
<summary>Contents</summary>

- [Example Interactions](#example-interactions)
- [Tools](#tools)
  - [Read Operations](#read-operations)
  - [Album Operations](#album-operations)
  - [Play / Create Operations](#play--create-operations)
  - [Playlist Operations](#playlist-operations)
- [Setup](#setup)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Creating a Spotify Developer Application](#creating-a-spotify-developer-application)
  - [Spotify API Configuration](#spotify-api-configuration)
  - [Authentication Process](#authentication-process)
  - [Session-only PKCE for local MCP clients](#session-only-pkce-for-local-mcp-clients)
- [Integrating with Claude Desktop, Cursor, and VsCode (Cline)](#integrating-with-claude-desktop-and-cursor)
  - [Streamable HTTP](#streamable-http)
  - [OAuth (MCPHub and other OAuth-capable clients)](#oauth-mcphub-and-other-oauth-capable-clients)
  - [Docker (recommended for MCPHub)](#docker-recommended-for-mcphub)
</details>

## Example Interactions

- _"Play Elvis's first song"_
- _"Create a Taylor Swift / Slipknot fusion playlist"_
- _"Copy all the techno tracks from my workout playlist to my work playlist"_
- _"Turn the volume down a bit"_

## Tools

### Read Operations

For exact observations, use `getPlaybackState()` rather than the formatted `getNowPlaying()` summary. It returns the active device, item URI, context, millisecond progress, repeat/shuffle state and action flags. `waitForPlaybackState({ deviceId, itemUri?, isPlaying?, minProgressMs?, maxProgressMs?, timeoutMs? })` polls for up to 10 seconds after a command and returns `matched` plus the last observed state; it does not itself send a playback command. Spotify may accept a command before reads reflect it.

`getTrack({ trackId })` resolves one catalog track to its album ID, duration, artists, ISRC when present, and availability fields. `getRecentlyPlayedPage({ limit?, after?, before? })` returns track IDs, timestamps, contexts and pagination cursors; `after` and `before` are Unix milliseconds and cannot be combined. These catalog APIs do not expose the desktop client's quality setting or decoded source bitrate.

1. **searchSpotify**

   - **Description**: Search for tracks, albums, artists, or playlists on Spotify
   - **Parameters**:
     - `query` (string): The search term
     - `type` (string): Type of item to search for (track, album, artist, playlist)
     - `limit` (number, optional): Maximum number of results to return (1-10, default: 10)
     - `offset` (number, optional): Index of the first result to return (default: 0)
   - **Returns**: List of matching items with their IDs, names, and additional details
   - **Example**: `searchSpotify("bohemian rhapsody", "track", 10)`

2. **getNowPlaying**

   - **Description**: Get information about the currently playing track on Spotify, including device and volume info
   - **Parameters**: None
   - **Returns**: Object containing track name, artist, album, playback progress, duration, playback state, device info, volume, and shuffle/repeat status
   - **Example**: `getNowPlaying()`

3. **getMyPlaylists**

   - **Description**: Get a list of the current user's playlists on Spotify
   - **Parameters**:
     - `limit` (number, optional): Maximum number of playlists to return (default: 20)
     - `offset` (number, optional): Index of the first playlist to return (default: 0)
   - **Returns**: Array of playlists with their IDs, names, track counts, and public status
   - **Example**: `getMyPlaylists(10, 0)`

4. **getPlaylistTracks**

   - **Description**: Get a list of tracks in a specific Spotify playlist
   - **Parameters**:
     - `playlistId` (string): The Spotify ID of the playlist
     - `limit` (number, optional): Maximum number of tracks to return (default: 100)
     - `offset` (number, optional): Index of the first track to return (default: 0)
   - **Returns**: Array of tracks with their IDs, names, artists, album, duration, and added date
   - **Example**: `getPlaylistTracks("37i9dQZEVXcJZyENOWUFo7")`

5. **getRecentlyPlayed**

   - **Description**: Retrieves a list of recently played tracks from Spotify.
   - **Parameters**:
     - `limit` (number, optional): A number specifying the maximum number of tracks to return.
   - **Returns**: If tracks are found it returns a formatted list of recently played tracks else a message stating: "You don't have any recently played tracks on Spotify".
   - **Example**: `getRecentlyPlayed({ limit: 10 })`

6. **getUsersSavedTracks**

   - **Description**: Get a list of tracks saved in the user's "Liked Songs" library
   - **Parameters**:
     - `limit` (number, optional): Maximum number of tracks to return (1-50, default: 50)
     - `offset` (number, optional): Offset for pagination (0-based index, default: 0)
   - **Returns**: Formatted list of saved tracks with track names, artists, duration, track IDs, and when they were added to Liked Songs. Shows pagination info (e.g., "1-20 of 150").
   - **Example**: `getUsersSavedTracks({ limit: 20, offset: 0 })`

7. **getQueue**

   - **Description**: Get the currently playing track and upcoming items in the Spotify queue
   - **Parameters**:
     - `limit` (number, optional): Maximum number of upcoming items to show (1-50, default: 10)
   - **Returns**: Currently playing track and list of upcoming tracks in the queue
   - **Example**: `getQueue({ limit: 20 })`

8. **getAvailableDevices**

   - **Description**: Get information about the user's available Spotify Connect devices
   - **Parameters**: None
   - **Returns**: List of available devices with name, type, active status, volume, and device ID
   - **Example**: `getAvailableDevices()`

9. **removeUsersSavedTracks**

   - **Description**: Remove one or more tracks from the user's "Liked Songs" library (max 40 per request)
   - **Parameters**:
     - `trackIds` (array): Array of Spotify track IDs to remove (max 40)
   - **Returns**: Success confirmation message
   - **Example**: `removeUsersSavedTracks({ trackIds: ["4iV5W9uYEdYUVa79Axb7Rh", "1301WleyT98MSxVHPZCA6M"] })`

10. **getFollowedArtists**

    - **Description**: Get the artists the current user follows
    - **Parameters**:
      - `limit` (number, optional): Maximum number of artists to return (1-50, default: 20)
      - `after` (string, optional): Cursor from a previous call (the last artist ID) to fetch the next page
    - **Returns**: Formatted list of followed artists with names and IDs (plus popularity and genres when Spotify provides them), and a cursor for the next page when more remain
    - **Example**: `getFollowedArtists({ limit: 50 })`

11. **getPlaybackState**

    - **Description**: Read structured player state, including the active device, item URI, progress in milliseconds, context, repeat/shuffle settings, and available actions
    - **Parameters**: None
    - **Returns**: JSON with `hasState: false` when no player state is available, or the selected state fields
    - **Example**: `getPlaybackState()`

12. **waitForPlaybackState**

    - **Description**: Poll player state for a selected device and optional item, play state, and progress range
    - **Parameters**: `deviceId` (required); optional `itemUri`, `isPlaying`, `minProgressMs`, `maxProgressMs`, `timeoutMs` (250–10000; default 5000)
    - **Returns**: `matched`, number of attempts, and the last observed state; a match is an observation, not proof that an earlier command caused it
    - **Example**: `waitForPlaybackState({ deviceId: "desktop-device-id", itemUri: "spotify:track:TRACK_ID", isPlaying: true })`

13. **getTrack**

    - **Description**: Resolve one track's catalog metadata, including album ID and available external IDs
    - **Parameters**: `trackId` (required)
    - **Returns**: Compact track, album, artist, duration, availability, and ISRC fields when supplied by Spotify
    - **Example**: `getTrack({ trackId: "TRACK_ID" })`

14. **getRecentlyPlayedPage**

    - **Description**: Read a page of recent playback with cursor support
    - **Parameters**: Optional `limit`, `after`, or `before`; cursors are Unix milliseconds and cannot be combined
    - **Returns**: Play timestamps, compact track/context details, and pagination cursors
    - **Example**: `getRecentlyPlayedPage({ limit: 20 })`


### Play / Create Operations

For device and playback settings, `transferPlayback({ deviceId, play?: false })` targets one discovered device and reports acceptance separately from an immediate observation. `setRepeatMode({ deviceId, state: "off" | "track" | "context" })` and `setShuffle({ deviceId, enabled: boolean })` target the active device and report the same distinction. Use `waitForPlaybackState` or a later `getPlaybackState` read when a command's effect must be confirmed. A progress range can verify a seek near its target. These tools use the existing playback scopes; no additional authorization scope is needed.

1. **playMusic**

   - **Description**: Start playing a track, album, artist, or playlist on Spotify
   - **Parameters**:
     - `uri` (string, optional): Spotify URI of the item to play (overrides type and id)
     - `type` (string, optional): Type of item to play (track, album, artist, playlist)
     - `id` (string, optional): Spotify ID of the item to play
     - `deviceId` (string): ID of the device to play on, found with `getAvailableDevices`
     - `positionMs` (number, optional): Starting position in milliseconds
   - **Returns**: API acceptance and a separate observed playback-state check
   - **Example**: Search with `searchSpotify`, then `playMusic({ deviceId: "desktop-device-id", uri: "spotify:track:6rqhFgbbKwnb9MLmUQDhG6", positionMs: 30000 })`
   - **Alternative**: `playMusic({ deviceId: "desktop-device-id", type: "track", id: "6rqhFgbbKwnb9MLmUQDhG6" })`
   - **Desktop fallback**: If a direct track request is accepted but a later playback read does not show that track, find its album with `searchSpotify`, locate its zero-based position with `getAlbumTracks`, then call `playMusic({ deviceId, context_uri: "spotify:album:ALBUM_ID", offset: POSITION })`. Verify the resulting track with `getNowPlaying`; an accepted request alone is not proof that playback changed.

2. **pausePlayback**

   - **Description**: Pause the currently playing track on Spotify
   - **Parameters**:
     - `deviceId` (string, optional): ID of the device to pause
   - **Returns**: Success status
   - **Example**: `pausePlayback()`

3. **resumePlayback**

   - **Description**: Resume Spotify playback on the active device
   - **Parameters**:
     - `deviceId` (string, optional): ID of the device to resume playback on
   - **Returns**: Success status
   - **Example**: `resumePlayback()`

4. **skipToNext**

   - **Description**: Skip to the next track in the current playback queue
   - **Parameters**:
     - `deviceId` (string, optional): ID of the device
   - **Returns**: Success status
   - **Example**: `skipToNext()`

5. **skipToPrevious**

   - **Description**: Skip to the previous track in the current playback queue
   - **Parameters**:
     - `deviceId` (string, optional): ID of the device
   - **Returns**: Success status
   - **Example**: `skipToPrevious()`

6. **createPlaylist**

   - **Description**: Create a new playlist on Spotify
   - **Parameters**:
     - `name` (string): Name for the new playlist
     - `description` (string, optional): Description for the playlist
     - `public` (boolean, optional): Whether the playlist should be public (default: false)
   - **Returns**: Object with the new playlist's ID and URL
   - **Example**: `createPlaylist({ name: "Workout Mix", description: "Songs to get pumped up", public: false })`

7. **addTracksToPlaylist**

   - **Description**: Add tracks to an existing Spotify playlist
   - **Parameters**:
     - `playlistId` (string): ID of the playlist
     - `trackUris` (array): Array of track URIs or IDs to add
     - `position` (number, optional): Position to insert tracks
   - **Returns**: Success status and snapshot ID
   - **Example**: `addTracksToPlaylist({ playlistId: "3cEYpjA9oz9GiPac4AsH4n", trackUris: ["spotify:track:4iV5W9uYEdYUVa79Axb7Rh"] })`

8. **addToQueue**

   - **Description**: Adds a track, album, artist or playlist to the current playback queue
   - **Parameters**:
     - `uri` (string, optional): Spotify URI of the item to add to queue (overrides type and id)
     - `type` (string, optional): Type of item to queue (track, album, artist, playlist)
     - `id` (string, optional): Spotify ID of the item to queue
     - `deviceId` (string, optional): ID of the device to queue on
   - **Returns**: Success status
   - **Example**: `addToQueue({ uri: "spotify:track:6rqhFgbbKwnb9MLmUQDhG6" })`
   - **Alternative**: `addToQueue({ type: "track", id: "6rqhFgbbKwnb9MLmUQDhG6" })`

9. **setVolume**

   - **Description**: Set the playback volume to a specific percentage (requires Spotify Premium)
   - **Parameters**:
     - `volumePercent` (number): The volume to set (0-100)
     - `deviceId` (string, optional): ID of the device to set volume on
   - **Returns**: Success status with the new volume level
   - **Example**: `setVolume({ volumePercent: 50 })`

10. **adjustVolume**

   - **Description**: Adjust the playback volume up or down by a relative amount (requires Spotify Premium)
   - **Parameters**:
     - `adjustment` (number): The amount to adjust volume by (-100 to 100). Positive values increase volume, negative values decrease it.
     - `deviceId` (string, optional): ID of the device to adjust volume on
   - **Returns**: Success status showing the volume change (e.g., "Volume increased from 50% to 60%")
   - **Example**: `adjustVolume({ adjustment: 10 })` (increase by 10%)
   - **Example**: `adjustVolume({ adjustment: -20 })` (decrease by 20%)

11. **seekToPosition**

   - **Description**: Move to an absolute time within the track or episode already loaded on a selected active device, without starting a different item
   - **Parameters**:
     - `deviceId` (string): ID of the active device, found with `getAvailableDevices`
     - `positionMs` (number): Positive time from the beginning in milliseconds; use `1` for nearly the start
   - **Returns**: API acceptance and a separate read of the observed item and position. A delayed state update may report `positionObserved=false` even after acceptance.
   - **Example**: `seekToPosition({ deviceId: "desktop-device-id", positionMs: 90000 })`

12. **transferPlayback**

    - **Description**: Select one currently available Spotify Connect device
    - **Parameters**: `deviceId` (required); `play` (optional, defaults to false)
    - **Returns**: API acceptance and a separate immediate device-state observation
    - **Example**: `transferPlayback({ deviceId: "desktop-device-id", play: false })`

13. **setRepeatMode**

    - **Description**: Set repeat on the selected active device
    - **Parameters**: `deviceId` and `state` (`off`, `track`, or `context`)
    - **Returns**: API acceptance and a separate immediate repeat-state observation
    - **Example**: `setRepeatMode({ deviceId: "desktop-device-id", state: "context" })`

14. **setShuffle**

    - **Description**: Set shuffle on the selected active device
    - **Parameters**: `deviceId` and `enabled` (boolean)
    - **Returns**: API acceptance and a separate immediate shuffle-state observation
    - **Example**: `setShuffle({ deviceId: "desktop-device-id", enabled: false })`


### Album Operations

1. **getAlbums**

   - **Description**: Get detailed information about one or more albums by their Spotify IDs
   - **Parameters**:
     - `albumIds` (string|array): A single album ID or array of album IDs (max 20)
   - **Returns**: Album details including name, artists, release date, type, total tracks, and ID. For single album returns detailed view, for multiple albums returns summary list.
   - **Example**: `getAlbums("4aawyAB9vmqN3uQ7FjRGTy")` or `getAlbums(["4aawyAB9vmqN3uQ7FjRGTy", "1DFixLWuPkv3KT3TnV35m3"])`

2. **getAlbumTracks**

   - **Description**: Get tracks from a specific album with pagination support
   - **Parameters**:
     - `albumId` (string): The Spotify ID of the album
     - `limit` (number, optional): Maximum number of tracks to return (1-50)
     - `offset` (number, optional): Offset for pagination (0-based index)
   - **Returns**: List of tracks from the album with track names, artists, duration, and IDs. Shows pagination info.
   - **Example**: `getAlbumTracks("4aawyAB9vmqN3uQ7FjRGTy", 10, 0)`

3. **saveOrRemoveAlbumForUser**

   - **Description**: Save or remove albums from the user's "Your Music" library
   - **Parameters**:
     - `albumIds` (array): Array of Spotify album IDs (max 20)
     - `action` (string): Action to perform: "save" or "remove"
   - **Returns**: Success status with confirmation message
   - **Example**: `saveOrRemoveAlbumForUser(["4aawyAB9vmqN3uQ7FjRGTy"], "save")`

4. **checkUsersSavedAlbums**

   - **Description**: Check if albums are saved in the user's "Your Music" library
   - **Parameters**:
     - `albumIds` (array): Array of Spotify album IDs to check (max 20)
   - **Returns**: Status of each album (saved or not saved)
   - **Example**: `checkUsersSavedAlbums(["4aawyAB9vmqN3uQ7FjRGTy", "1DFixLWuPkv3KT3TnV35m3"])`

### Playlist Operations

1. **getPlaylist**

   - **Description**: Get details of a specific Spotify playlist including tracks count, description and owner
   - **Parameters**:
     - `playlistId` (string): The Spotify ID of the playlist
   - **Returns**: Playlist name, owner, track count, visibility, description, ID, and URL
   - **Example**: `getPlaylist({ playlistId: "37i9dQZEVXcJZyENOWUFo7" })`

2. **updatePlaylist**

   - **Description**: Update the details of a Spotify playlist (name, description, public/private, collaborative)
   - **Parameters**:
     - `playlistId` (string): The Spotify ID of the playlist
     - `name` (string, optional): New name for the playlist
     - `description` (string, optional): New description for the playlist
     - `public` (boolean, optional): Whether the playlist should be public
     - `collaborative` (boolean, optional): Whether the playlist should be collaborative (requires public to be false)
   - **Returns**: Success confirmation with list of updated fields
   - **Example**: `updatePlaylist({ playlistId: "3cEYpjA9oz9GiPac4AsH4n", name: "New Name", public: true })`

3. **removeTracksFromPlaylist**

   - **Description**: Remove one or more tracks from a Spotify playlist (max 100 tracks per request)
   - **Parameters**:
     - `playlistId` (string): The Spotify ID of the playlist
     - `trackIds` (array): Array of Spotify track IDs to remove (max 100)
     - `snapshotId` (string, optional): The playlist snapshot ID to target a specific version
   - **Returns**: Success confirmation with the number of tracks removed
   - **Example**: `removeTracksFromPlaylist({ playlistId: "3cEYpjA9oz9GiPac4AsH4n", trackIds: ["4iV5W9uYEdYUVa79Axb7Rh"] })`

4. **reorderPlaylistItems**

   - **Description**: Reorder a range of tracks within a Spotify playlist by moving them to a new position
   - **Parameters**:
     - `playlistId` (string): The Spotify ID of the playlist
     - `rangeStart` (number): The position of the first item to move (0-based index)
     - `insertBefore` (number): The position where the items should be inserted (0-based index)
     - `rangeLength` (number, optional): Number of consecutive items to move (defaults to 1)
     - `snapshotId` (string, optional): The playlist snapshot ID to target a specific version
   - **Returns**: Success confirmation with the move details
   - **Example**: `reorderPlaylistItems({ playlistId: "3cEYpjA9oz9GiPac4AsH4n", rangeStart: 2, insertBefore: 0 })`

## Setup

### Prerequisites

- Latest Node.js Current release (currently v26.8.1; older release lines are unsupported)
- A Spotify Premium account
- A registered Spotify Developer application

### Installation

```bash
git clone --branch codex/controlled-playback https://github.com/Phishinabowl/spotify-mcp-server.git
cd spotify-mcp-server
npm ci
npm run build
```

### Creating a Spotify Developer Application

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/)
2. Log in with your Spotify account
3. Click the "Create an App" button
4. Fill in the app name and description
5. Accept the Terms of Service and click "Create"
6. In your new app's dashboard, you'll see your **Client ID**
7. For session-only PKCE, add the Redirect URI `http://127.0.0.1:8765/callback`; this mode needs the public Client ID but no client secret. For the legacy file-backed flow below, use its configured redirect URI (for example, `http://127.0.0.1:8888/callback`) and copy the client secret from the app dashboard.
8. Save your changes

### Spotify API Configuration

This file-backed configuration is for the legacy `npm run auth` flow. Local clients using the session-only PKCE setup below do not create `spotify-config.json`.

Create a `spotify-config.json` file in the project root (you can copy and modify the provided example):

```bash
# Copy the example config file
cp spotify-config.example.json spotify-config.json
```

Then edit the file with your credentials:

```json
{
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "redirectUri": "http://127.0.0.1:8888/callback"
}
```

### Authentication Process

The Spotify API uses OAuth 2.0 for authentication. Follow these steps to authenticate your application:

1. Run the authentication script:

```bash
npm run auth
```

2. The script will generate an authorization URL. Open this URL in your web browser.

3. You'll be prompted to log in to Spotify and authorize your application.

4. After authorization, Spotify will redirect you to your specified redirect URI with a code parameter in the URL.

5. The authentication script will automatically exchange this code for access and refresh tokens.

6. These tokens will be saved to your `spotify-config.json` file, which will now look something like:

```json
{
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "redirectUri": "http://localhost:8888/callback",
  "accessToken": "BQAi9Pn...kKQ",
  "refreshToken": "AQDQcj...7w",
  "expiresAt": 1677889354671
}
```

**Note**: The `expiresAt` field is a Unix timestamp (in milliseconds) indicating when the access token expires.

7. **Automatic Token Refresh**: The server will automatically refresh the access token when it expires (typically after 1 hour). The refresh happens transparently using the `refreshToken`, so you don't need to re-authenticate manually. If the refresh fails, you'll need to run `npm run auth` again to re-authenticate.

### Session-only PKCE for local MCP clients

This alternative runs the built server over stdio with `SPOTIFY_SESSION_AUTH=pkce`. It uses the public Client ID and the exact redirect URI `http://127.0.0.1:8765/callback`. It does not need a client secret or `spotify-config.json`. Access and refresh tokens remain in the MCP process's memory; closing or reloading that process requires a new browser authorization. Keep the callback port available while authorizing.

Configure your MCP client to launch `build/index.js` with Node.js 26.8.1 or newer and these environment variables. For example, a Windows Codex `config.toml` entry can use:

```toml
[mcp_servers.spotify]
command = 'C:\path\to\node.exe'
args = ['C:\path\to\spotify-mcp-server\build\index.js']
enabled = true

[mcp_servers.spotify.env]
SPOTIFY_CLIENT_ID = "your-public-client-id"
SPOTIFY_SESSION_AUTH = "pkce"
SPOTIFY_REQUIRE_DEVICE = "true"
```

Use absolute paths that exist on your machine. `SPOTIFY_REQUIRE_DEVICE=true` requires an explicit device for the remaining playback controls; `playMusic` and `resumePlayback` already require one in this fork. After adding or editing the MCP entry, reload the client/server and check that its Spotify tools appear.

1. Call `beginSpotifyAuthorization()`. Open the returned URL yourself and approve Spotify's consent page within ten minutes. The callback receipt page does not by itself prove token exchange succeeded.
2. Call `getSpotifyAuthorizationStatus()` and wait for `phase: "ready"`. This flow requests the scope set needed by the server's available tools; review the consent screen before approving it.
3. Call `getAvailableDevices()` and use the desired device's ID for controls. If no player is active, `transferPlayback({ deviceId, play: false })` can select one without starting music.
4. For a specific album track, use `getTrack` or `searchSpotify` to find its album, `getAlbumTracks` to find its zero-based offset, then call `playMusic({ deviceId, context_uri: "spotify:album:ALBUM_ID", offset: 0, positionMs: 0 })`. Confirm the exact item and device with `waitForPlaybackState`; an accepted command can precede the matching read. Direct track-URI playback remains available, but it did not reliably start the requested item in the recorded desktop trials.

`closeSpotifySession()` discards in-memory tokens and cached clients. The session-only flow is independent of the file-backed flow above and of the separate HTTP OAuth mode below.

## Integrating with Claude Desktop, Cursor, and VsCode [Via Cline model extension](https://marketplace.visualstudio.com/items/?itemName=saoudrizwan.claude-dev)

To use your MCP server with Claude Desktop, add it to your Claude configuration:

```json
{
  "mcpServers": {
    "spotify": {
      "command": "node",
      "args": ["spotify-mcp-server/build/index.js"]
    }
  }
}
```

For Cursor, go to the MCP tab in `Cursor Settings` (command + shift + J). Add a server with this command:

```bash
node path/to/spotify-mcp-server/build/index.js
```

To set up your MCP correctly with Cline ensure you have the following file configuration set `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "spotify": {
      "command": "node",
      "args": ["~/../spotify-mcp-server/build/index.js"],
      "autoApprove": ["getListeningHistory", "getNowPlaying"]
    }
  }
}
```

You can add additional tools to the auto approval array to run the tools without intervention.

### Streamable HTTP

The server uses stdio by default. To run one long-lived process that several MCP clients connect to over HTTP instead, set `MCP_TRANSPORT=http`:

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=3000 node path/to/spotify-mcp-server/build/index.js
```

Clients then connect to `http://127.0.0.1:3000/mcp`. `MCP_HTTP_PORT` defaults to `3000` and `MCP_HTTP_HOST` to `127.0.0.1`. On a loopback address, requests whose `Host` or `Origin` header names anything other than `localhost`, `127.0.0.1`, `[::1]`, `MCP_HTTP_HOST` or the bound address are rejected to prevent DNS rebinding. The endpoint has no authentication, so only bind another address behind something that provides it.

### OAuth (MCPHub and other OAuth-capable clients)

Set `MCP_AUTH=spotify` in addition to `MCP_TRANSPORT=http`. The server then acts as an OAuth-protected MCP endpoint (RFC 9728) whose authorization server is Spotify itself:

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=3000 MCP_AUTH=spotify node path/to/spotify-mcp-server/build/index.js
```

- `POST /mcp` without an `Authorization: Bearer` header returns `401` with a `WWW-Authenticate` challenge pointing at `/.well-known/oauth-protected-resource`.
- That metadata document advertises `https://accounts.spotify.com` as the authorization server (plus the full required scope set under `scopes_supported`), so clients with OAuth support (e.g. MCPHub) discover Spotify, run the authorization-code flow in the browser, and reconnect with the issued access token.
- The Bearer token is used **per request** as the Spotify access token and is never written to `spotify-config.json` — no `npm run auth`, no stored refresh token, no token-refresh timer. Token rotation by the client is handled transparently.
- On the first request of each new token (i.e. on rotation) the server validates it against Spotify (`GET /me`) and memoises the result. If Spotify rejects the token the server answers `401` with `WWW-Authenticate: Bearer error="invalid_token"`, so the client knows to reauthorise. A token is **not trusted forever**: if Spotify later 401s a tool call with an already-validated token (expiry or revocation), the server evicts it from the validation memo, and the next request re-runs the `/me` ping instead of reusing the stale result. Spotify issues opaque tokens (no JWKS, no public introspection endpoint), so the `/me` ping is the strongest validation possible without the client secret — it proves the token works with Spotify, but cannot verify the token was issued for *this* app (that would require the client secret, which this mode deliberately does not hold).
- `spotify-config.json` is not required in this mode. stdio mode is unchanged and still uses the config file.

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MCP_AUTH` | unset (stdio/config-file mode) | `spotify` enables Bearer-token auth on the HTTP transport |
| `SPOTIFY_RESOURCE_URL` | derived from bind host/port | `resource` value in the protected-resource metadata. Set this to the public URL the MCP client uses when the server is reachable under a different address (reverse proxy, Docker port mapping). |
| `SPOTIFY_AUTHORIZATION_SERVERS` | `https://accounts.spotify.com` | Comma-separated list of authorization server URLs in the metadata. |

**One-time Spotify app setup** (same dashboard as for the other flows): add the redirect URI your MCP client uses for callbacks (e.g. `http://127.0.0.1:3000/oauth/callback` for a local MCPHub dashboard — Spotify rejects `localhost` redirect URIs for new apps, so use `127.0.0.1` or an HTTPS URL) and copy the **client ID** into the client's OAuth configuration. Spotify does not support dynamic client registration, so the client ID must be provided manually. The client secret is only needed by clients that exchange the code using `client_secret_basic`/`client_secret_post`.

Request the **full scope set** advertised in the metadata's `scopes_supported` (15 scopes); if a client requests fewer, tools that need the missing scopes fail with `403`.

Example MCPHub configuration:

```json
{
  "mcpServers": {
    "spotify": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3000/mcp",
      "oauth": {
        "clientId": "your-spotify-client-id",
        "authorizationEndpoint": "https://accounts.spotify.com/authorize",
        "tokenEndpoint": "https://accounts.spotify.com/api/token",
        "redirectUri": "http://127.0.0.1:3000/oauth/callback",
        "scopes": [
          "user-read-private",
          "user-read-email",
          "user-read-playback-state",
          "user-modify-playback-state",
          "user-read-currently-playing",
          "user-read-playback-position",
          "playlist-read-private",
          "playlist-read-collaborative",
          "playlist-modify-private",
          "playlist-modify-public",
          "user-library-read",
          "user-library-modify",
          "user-read-recently-played",
          "user-top-read",
          "user-follow-read"
        ],
        "resource": "http://127.0.0.1:3000"
      }
    }
  }
}
```

### Docker (recommended for MCPHub)

The repository ships a `Dockerfile` (multi-stage, `node:26-alpine`, unprivileged
user) and a `docker-compose.yml` that run the server in **OAuth-protected
Streamable HTTP mode** on an internal Docker network. No host port is published,
so the server is not exposed on the host's external interfaces — only your
MCPHub container (on the same Docker network) can reach it at
`http://spotify-mcp:3000/mcp`. Only the MCPHub dashboard/callback URL needs to
be publicly reachable, because Spotify's `redirect_uri` points at MCPHub.

The image needs **no client secret, no refresh token and no `spotify-config.json`**.

1. Build and start the server:

   ```bash
   docker compose up -d --build
   ```

2. In the Spotify Developer Dashboard, add the **MCPHub callback URL** as a
   redirect URI for your app (e.g. `http://127.0.0.1:3000/oauth/callback` for a
   local MCPHub — Spotify rejects `localhost` redirect URIs for new apps — or
   your deployed MCPHub dashboard domain) and copy the **client ID**.

3. Connect MCPHub to the server. Point `url` at the Docker DNS name and set
   `resource` to the same value (this must match `SPOTIFY_RESOURCE_URL`, which
   the server advertises in its protected-resource metadata):

   ```json
   {
     "mcpServers": {
       "spotify": {
         "type": "streamable-http",
         "url": "http://spotify-mcp:3000/mcp",
         "oauth": {
           "clientId": "your-spotify-client-id",
           "authorizationEndpoint": "https://accounts.spotify.com/authorize",
           "tokenEndpoint": "https://accounts.spotify.com/api/token",
           "redirectUri": "http://127.0.0.1:3000/oauth/callback",
           "scopes": [
             "user-read-private",
             "user-read-email",
             "user-read-playback-state",
             "user-modify-playback-state",
             "user-read-currently-playing",
             "user-read-playback-position",
             "playlist-read-private",
             "playlist-read-collaborative",
             "playlist-modify-private",
             "playlist-modify-public",
             "user-library-read",
             "user-library-modify",
             "user-read-recently-played",
             "user-top-read",
             "user-follow-read"
           ],
           "resource": "http://spotify-mcp:3000"
         }
       }
     }
   }
   ```

   The two `spotify-mcp` containers must share a Docker network. If MCPHub
   already runs in its own compose stack, join them: add the network to the
   MCPHub service **and** declare the shared network `external: true` in
   **both** compose files.

   MCPHub service (`mcphub` compose file):

   ```yaml
   services:
     mcphub:
       networks:
         - mcphub          # its own network (from its existing file)
         - spotify-mcp     # join the Spotify MCP network
   networks:
     spotify-mcp:
       external: true      # the network is created by the other stack
   ```

   Or, if you manage both yourself, create the network once with
   `docker network create spotify-mcp` and mark it `external: true` in
   **both** compose files — including this one's `spotify-mcp` network
   definition — so neither stack tries to create it.

4. In MCPHub, the first call triggers the Spotify authorization flow in the
   browser; MCPHub stores the tokens and rotates them automatically.

If MCPHub reaches the server through a different address (another host, a
reverse proxy), set `SPOTIFY_RESOURCE_URL` in `.env` to that URL and mirror it
in MCPHub's `oauth.resource`.

## Development

The server uses MCP TypeScript SDK v2 and Zod 4, serving protocol revision `2026-07-28` while retaining compatibility with legacy MCP clients. Only the latest Node.js Current release is supported (minimum v26.8.1). CI follows the latest Current release. Install the locked dependencies with `npm ci`.

```bash
npm run lint
npm run typecheck
npm test
```

Tests exercise MCP initialization, tool discovery, validation, and Spotify operations using mocked HTTP responses. They do not require Spotify credentials or change your Spotify account.
