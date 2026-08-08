import type { AiAppInfo } from "../runtime-types.ts";

export function gatewayConfirmationLines(info: AiAppInfo) {
  const background = info.background!;
  return [
    `应用：${background.appId} · ${background.version}`,
    `包哈希：${info.packageHash}`,
    `后台触发器：${background.triggerCount}`,
    ...background.triggers.map((trigger) => `${trigger.type === "cron" ? "Cron" : "Heartbeat"} ${trigger.id}：${trigger.schedule}`),
    `CONTACT 节点：${background.contactCount}`,
    `Webhook：${background.requiresWebhook ? "需要配置并发送通知内容" : "不需要"}`,
    ...info.bundles.flatMap((bundle) => [`${bundle.kind.toUpperCase()}：${bundle.id} · ${bundle.signed ? "已签名" : "未签名"}`, `权限：${bundle.permissions.join("、") || "无"}`]),
    "",
    "接受后将安装当前用户级登录自启 Gateway 并启用该应用。",
    "拒绝会停用已安装的同 ID 应用并退出。",
  ];
}

export function gatewayConfirmationCommand(text: string | undefined, key: { name?: string; ctrl?: boolean }) {
  if (key.ctrl && key.name === "c") return "interrupt" as const;
  if (key.name === "escape" || text?.toLowerCase() === "n") return "reject" as const;
  if (text?.toLowerCase() === "y") return "accept" as const;
  return "ignore" as const;
}
