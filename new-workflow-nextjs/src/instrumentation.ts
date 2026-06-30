// Runs once when the server process starts, independent of any request or of
// the gramJS userbot client connecting. Starting Bot API polling here means
// the bot is back to responding to button clicks/replies within seconds of a
// deploy/restart, instead of waiting minutes for the gramJS sync to finish.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { autoStartFromConfig } = await import('./lib/bot-listener');
  autoStartFromConfig().catch((err: any) => {
    console.error('[Instrumentation] autoStartFromConfig failed:', err?.message || err);
  });
}
