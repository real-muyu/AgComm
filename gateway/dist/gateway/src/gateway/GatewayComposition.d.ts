import { RuntimeGateway, type RuntimeGatewayOptions } from "./RuntimeGateway.ts";
/** Creates the production Gateway composition without coupling the facade to executor implementation. */
export declare function createRuntimeGateway(options?: RuntimeGatewayOptions): RuntimeGateway;
