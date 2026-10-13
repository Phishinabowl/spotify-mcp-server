# Controlled Spotify MCP integration

The fork retains upstream's API tools and transports. Changes are maintained on codex/controlled-playback, initially based on upstream e6c817482d25a41b068c2b231e3bc39c8c5d6e4a. The wstrinz and Dienert forks were reviewed as architectural references; their source was not copied into this increment.

## Session authentication

Set SPOTIFY_SESSION_AUTH=pkce and SPOTIFY_CLIENT_ID to a public Developer app ID. The app redirect must be http://127.0.0.1:8765/callback. Three additional tools begin authorization, read its status and close the session. The owner opens the returned link manually. Sign-in requests upstream's full scope set; no client secret is needed. Tokens remain in memory, refresh there and are discarded with cached SDK clients when the session closes. Process termination also discards memory. Legacy file-backed authentication remains available when this mode is unset.

The callback page is a separate presentation component adapted from the investigation controller. Its success page acknowledges receipt before token exchange, attempts tab closure after three seconds and provides a manual fallback. Confirm authorization with the status tool. Invalid callbacks do not exchange codes. Callback errors and URLs are not logged.

## Playback

playMusic and resumePlayback require an explicit discovered device and refuse fallback when it is unavailable. Set SPOTIFY_REQUIRE_DEVICE=true to require explicit devices for the remaining playback controls. Library and playlist commands are unaffected by this device rule. Granted OAuth scopes do not constitute instructions to modify account data.

playMusic supports context playback with numeric offset or offsetUri, plus positionMs. Results distinguish accepted requests from observed matching device/track state. A single state read does not verify advancing progress or prove sustained playback; subsequent getNowPlaying calls are required. A delayed provider update may initially report playbackObserved=false. Single-track URI playback remains available but is not established to work on every desktop build.

Generic JSON parse errors no longer become successful operations. The direct API helper ignores non-JSON successful mutation bodies while retaining JSON mutation results. Upstream POSIX permission tests are skipped on Windows because they cannot validate Windows ACLs. Session mode does not write credential files.

## Verification

Build and run the Node test suite using a runtime satisfying package.json. New tests cover device fallback refusal, wrong-track observations, strict untargeted control rejection, PKCE, callback-state validation, valid token exchange and session closure. Live Spotify consent/playback and native chat connectivity are separate checks.
