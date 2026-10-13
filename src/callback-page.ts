import fs from 'node:fs';

const template = fs.readFileSync(
  new URL('./callback-page.html', import.meta.url),
  'utf8',
);
export function renderCallbackPage(accepted: boolean) {
  const values: Record<string, string> = {
    title: accepted ? 'Authorization received' : 'Authorization not accepted',
    description: accepted
      ? 'Return to Codex to confirm your connection.'
      : 'Return to Codex and start a new sign-in attempt.',
    state: accepted ? 'accepted' : 'rejected',
    icon: accepted
      ? '<path d="m7 16 6 6L25 10" />'
      : '<path d="m10 10 12 12m0-12L10 22" />',
    status: accepted
      ? 'Attempting to close in 3 seconds…'
      : 'This tab will stay open. You can close it when you are ready.',
    noscript: 'You can close this tab now.',
    script:
      "try { history.replaceState(null, '', location.pathname); } catch (_) {}" +
      (accepted
        ? `
      const status = document.getElementById('close-status');
      let seconds = 3;
      const countdown = setInterval(() => { seconds--; if (seconds > 0) status.textContent = 'Attempting to close in ' + seconds + ' seconds…'; }, 1000);
      setTimeout(() => { clearInterval(countdown); status.textContent = 'You can safely close this tab now.'; window.close(); }, 3000);
    `
        : ''),
  };
  return template.replace(/\$(\w+)/g, (_, key: string) => values[key]);
}
