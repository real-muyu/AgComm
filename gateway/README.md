# @agcomm/gateway

AgComm Gateway is the local background control plane for AgComm Beta 1 applications. It manages application installation, Heartbeat and Cron scheduling, background runs, local IPC, Inbox records, Webhook delivery, stream logs and current-user login services.

```ts
import { connectRuntimeGateway, createRuntimeGateway } from "@agcomm/gateway";

const client = await connectRuntimeGateway();
console.log(await client.listApps());

const gateway = createRuntimeGateway({ runtime: { provider } });
await gateway.start();
```

Installing `@agcomm/ai-runtime` installs this package automatically. The `agcomm gateway run` daemon command, local data directory and IPC protocol remain owned by the Runtime user experience.

This package is licensed under Elastic License 2.0. The SDK is MIT licensed and the Runtime is LGPL-3.0-only.

