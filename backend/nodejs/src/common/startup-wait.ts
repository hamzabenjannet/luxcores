const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `attempt` until it works or `windowMs` has passed, pausing `pauseMs` between tries, and
 * rethrows the last error. A service that is still starting (a database container that booted a second
 * ago) is not down, so the server gives it a short window at start-up before it runs without it.
 */
export async function withinWindow<T>(attempt: () => Promise<T>, windowMs: number, pauseMs = 400): Promise<T> {
  const end = Date.now() + windowMs;
  for (;;) {
    try {
      return await attempt();
    } catch (err) {
      if (Date.now() + pauseMs >= end) throw err;
      await sleep(pauseMs);
    }
  }
}
