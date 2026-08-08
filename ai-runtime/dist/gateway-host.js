import {
  AiRuntimeError,
  BACKGROUND_RUN,
  createRuntimeKernel,
  createSafeOutboundFetch,
  validateResolvedPublicUrl
} from "./chunks/chunk-V5FW7JF6-bundle.js";
import "./chunks/chunk-MZWYF3I5-bundle.js";

// src/gateway-host.ts
async function inspectGatewayPackage(pathOrBytes, runtimeOptions = {}) {
  const runtime = createRuntimeKernel(runtimeOptions);
  const opened = await runtime.openAiApp(pathOrBytes);
  try {
    await opened.preflight();
    const details = opened.info.background;
    if (!details || !opened.background) {
      throw new AiRuntimeError("GATEWAY_BACKGROUND_REQUIRED", "Only apps with stable id, version, and background declarations can be installed");
    }
    return {
      appId: details.appId,
      name: opened.name,
      version: details.version,
      packageHash: opened.packageHash,
      background: structuredClone(opened.background),
      requiresWebhook: details.requiresWebhook,
      defaultStreamMode: opened.interaction?.streaming?.defaultMode ?? "text"
    };
  } finally {
    await opened.dispose();
    await runtime.dispose();
  }
}
async function executeGatewayTrigger(pathOrBytes, runtimeOptions, runOptions, services) {
  const runtime = createRuntimeKernel(runtimeOptions);
  const opened = await runtime.openAiApp(pathOrBytes);
  try {
    return await opened[BACKGROUND_RUN](runOptions, services);
  } finally {
    await opened.dispose();
    await runtime.dispose();
  }
}
export {
  AiRuntimeError,
  createSafeOutboundFetch,
  executeGatewayTrigger,
  inspectGatewayPackage,
  validateResolvedPublicUrl
};
