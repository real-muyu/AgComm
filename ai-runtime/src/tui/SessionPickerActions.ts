import type { AiAppHandle, AiSessionHandle } from "../runtime-types.ts";
import type { TerminalScreen } from "../terminal-app.ts";
import type { SessionPickerItem } from "./SessionPickerState.ts";

export async function openSelectedSession(app: AiAppHandle, item: SessionPickerItem): Promise<AiSessionHandle> {
  return item.id ? app.openSession(item.id) : app.createSession();
}

export async function renameSelectedSession(screen: TerminalScreen, app: AiAppHandle, item: SessionPickerItem, signal?: AbortSignal) {
  const title = await screen.prompt(app.name, "新的会话名称", signal);
  if (!title) return;
  const session = await app.openSession(item.id);
  try {
    await session.rename(title);
  } finally {
    await session.dispose();
  }
}
