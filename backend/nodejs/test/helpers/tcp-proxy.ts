import net from 'node:net';

/**
 * A TCP proxy that a test can cut and restore, to make a real service look unreachable and then come
 * back, without stopping a container. Cutting closes every open connection and refuses new ones.
 */
export class TcpProxy {
  private server?: net.Server;
  private readonly sockets = new Set<net.Socket>();

  constructor(
    private readonly targetHost: string,
    private readonly targetPort: number,
  ) {}

  /** Listens on `port`, or on a free port when none is given. Returns the port. */
  async start(port = 0): Promise<number> {
    this.server = net.createServer((client) => {
      const upstream = net.connect(this.targetPort, this.targetHost);
      for (const s of [client, upstream]) {
        this.sockets.add(s);
        s.on('close', () => this.sockets.delete(s));
        s.on('error', () => s.destroy());
      }
      client.pipe(upstream);
      upstream.pipe(client);
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => client.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(port, '127.0.0.1', resolve);
    });
    return (this.server.address() as net.AddressInfo).port;
  }

  /** Drops every connection and stops listening. */
  async cut(): Promise<number> {
    const port = (this.server?.address() as net.AddressInfo | null)?.port ?? 0;
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = undefined;
    return port;
  }

  async stop(): Promise<void> {
    await this.cut();
  }
}
