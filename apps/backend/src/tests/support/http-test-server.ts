import type { Server } from 'node:net';

type ListenApp = Readonly<{
  listen: (port: number, hostname: string, callback: () => void) => Server;
}>;

type StartedTestServer = Readonly<{
  baseUrl: string;
  close: () => Promise<void>;
}>;

const waitForServerReady = async (baseUrl: string): Promise<void> => {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health/live`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the local test server accepts connections.
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  throw new Error(`Timed out waiting for test server readiness at ${baseUrl}`);
};

export const startHttpTestServer = async (app: ListenApp): Promise<StartedTestServer> => {
  const server = await new Promise<Server>((resolve, reject) => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
    running.once('error', reject);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address info');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  await waitForServerReady(baseUrl);

  return {
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
};
