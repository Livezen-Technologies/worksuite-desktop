import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { flushDrafts } from '../../core/drafts';

/**
 * A conversation in its own window (#103). What has been typed is saved first,
 * so the new window opens with it; opening the same conversation again brings
 * its window forward instead of opening a second one (the main process).
 * It is an ordinary window — minimise, maximise, close — that can be kept on
 * top from its title bar; a call's chat starts on top, beside the call.
 */
export async function openChatWindow(roomId: string | number, title?: string, opts: { onTop?: boolean } = {}): Promise<void> {
  if (!app.get().lock?.locked) await flushDrafts();
  await call('windows:open', { kind: 'chat-mini', route: `/chat?room=${roomId}`, title: title ?? 'Chat', alwaysOnTop: !!opts.onTop });
}
