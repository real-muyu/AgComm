import {
  connectRuntimeGateway,
  installGatewayAutostart,
  type GatewayClientLike,
} from "../gateway-loader.ts";

export type GatewayConnectionOptions = {
  gateway?: GatewayClientLike;
  installService?: () => Promise<unknown>;
};

export class GatewayConnectionController {
  constructor(private readonly options: GatewayConnectionOptions) {}

  async ensure(): Promise<GatewayClientLike> {
    if (this.options.gateway) return this.options.gateway;
    const existing = await this.tryHealthyClient();
    if (existing) return existing;
    await (this.options.installService ?? installGatewayAutostart)();
    return this.waitForService();
  }

  async connected(): Promise<GatewayClientLike> {
    if (this.options.gateway) return this.options.gateway;
    const client = await connectRuntimeGateway();
    await this.assertHealthy(client);
    return client;
  }

  private async waitForService(): Promise<GatewayClientLike> {
    for (let attempt = 0; attempt < 40; attempt++) {
      await delay(250);
      const client = await this.tryHealthyClient();
      if (client) return client;
    }
    throw new Error("Runtime Gateway 启动超时");
  }

  private async tryHealthyClient(): Promise<GatewayClientLike | undefined> {
    return Promise.resolve().then(async () => {
      const client = await connectRuntimeGateway();
      await this.assertHealthy(client);
      return client;
    }).catch(() => undefined);
  }

  private async assertHealthy(client: GatewayClientLike): Promise<void> {
    const status = await client.ping();
    if (!status.healthy) throw new Error("Runtime Gateway heartbeat is stale");
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
