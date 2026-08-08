// SPDX-License-Identifier: Elastic-2.0
import { GatewayExecutor } from "./GatewayExecutor.ts";
import { RuntimeGateway, type RuntimeGatewayOptions } from "./RuntimeGateway.ts";

/** Creates the production Gateway composition without coupling the facade to executor implementation. */
export function createRuntimeGateway(options: RuntimeGatewayOptions = {}) {
  return new RuntimeGateway(options, new GatewayExecutor());
}
