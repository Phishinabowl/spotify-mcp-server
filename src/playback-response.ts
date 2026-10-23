// Player commands have no response document. Successful responses may contain
// opaque text even when their Content-Type says JSON; do not parse that text.
const commandMethods: Record<string, string> = {
  '/v1/me/player': 'PUT',
  '/v1/me/player/play': 'PUT',
  '/v1/me/player/pause': 'PUT',
  '/v1/me/player/next': 'POST',
  '/v1/me/player/previous': 'POST',
  '/v1/me/player/queue': 'POST',
  '/v1/me/player/seek': 'PUT',
  '/v1/me/player/volume': 'PUT',
  '/v1/me/player/repeat': 'PUT',
  '/v1/me/player/shuffle': 'PUT',
};

export function isPlaybackCommand(url: string, method: string): boolean {
  const parsed = new URL(url);
  return (
    parsed.origin === 'https://api.spotify.com' &&
    commandMethods[parsed.pathname] === method.toUpperCase()
  );
}

export async function normalizePlaybackResponse(
  input: string | URL | Request,
  init: RequestInit | undefined,
  response: Response,
): Promise<Response> {
  const request = new Request(input, init);
  if (!(response.ok && isPlaybackCommand(request.url, request.method)))
    return response;
  await response.body?.cancel();
  return new Response(null, { status: 204 });
}
