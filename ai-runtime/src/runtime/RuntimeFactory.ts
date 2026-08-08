import { createHttpModelProvider } from "../http-provider.ts";
import type { HttpModelProviderConfig } from "../provider-contracts.ts";
import type { ModelProvider, ProviderConfig } from "../model-provider.ts";

export function resolveModelProvider(value: ProviderConfig | HttpModelProviderConfig | ModelProvider | undefined) {
  if (value && typeof (value as ModelProvider).call === "function") return value as ModelProvider;
  if ((value as HttpModelProviderConfig | undefined)?.type === "http") return createHttpModelProvider(value as HttpModelProviderConfig);
  return (value as ProviderConfig | undefined)?.provider;
}

export function resolveProviderConfig(value: ProviderConfig | HttpModelProviderConfig | ModelProvider | undefined): ProviderConfig {
  if (value && typeof (value as ModelProvider).call !== "function" && (value as HttpModelProviderConfig).type !== "http") return value as ProviderConfig;
  return {};
}
