import { describe, expect, it } from 'vitest';
import { linkApp } from '@shared/access';
import { resolveWebLink } from '@shared/links';
import { channelOf } from '../../../src/modules/chat/channels/channels';
import { touchesWebsiteChat, websiteChatOf } from '../../../src/core/query';

/**
 * worksuite-desktop#407: the server's notifications about a website visitor's chat link to the web's
 * `/website-chats?conversation=N`. No desktop app sat under that path, so a click went to the browser and the
 * conversation never opened in Chat › Web Chat; the lists were not told to read again either.
 */
describe('website chat notifications open their conversation in Web Chat', () => {
  it('maps a conversation link to that chat in Web Chat', () => {
    expect(resolveWebLink('/website-chats?conversation=42')).toEqual({ kind: 'tab', route: '/chat?view=website&section=inbox&website=42', app: 'chat' });
    expect(resolveWebLink('/website-chats/42')).toEqual({ kind: 'tab', route: '/chat?view=website&section=inbox&website=42', app: 'chat' });
    expect(resolveWebLink('/website-chats?tab=inbox&conversation=7')).toMatchObject({ route: '/chat?view=website&section=inbox&website=7' });
  });

  it('maps the other website-chat pages to their sections', () => {
    expect(resolveWebLink('/website-chats?tab=visitors')).toEqual({ kind: 'tab', route: '/chat?view=website&section=visitors', app: 'chat' });
    expect(resolveWebLink('/website-chats?tab=widgets')).toMatchObject({ route: '/chat?view=website&section=widgets' });
    expect(resolveWebLink('/website-chats')).toMatchObject({ kind: 'tab', route: '/chat?view=website' });
    expect(resolveWebLink('/website-chats?conversation=abc')).toMatchObject({ route: '/chat?view=website' });
  });

  it('lands on the Web Chat channel and is gated by Chat', () => {
    const r = resolveWebLink('/website-chats?conversation=42');
    expect(r.kind === 'tab' && channelOf(new URLSearchParams(r.route.split('?')[1]))).toBe('website');
    expect(linkApp('/website-chats?conversation=42')).toBe('chat');
  });

  it('knows which notifications are about a website chat, and which one', () => {
    expect(touchesWebsiteChat({ type: 'notification', link: '/website-chats?conversation=42' })).toBe(true);
    expect(touchesWebsiteChat({ type: 'notification', link: '/website-chatsx' })).toBe(false);
    expect(touchesWebsiteChat({ type: 'notification', link: '/chat?room=3' })).toBe(false);
    expect(touchesWebsiteChat({ type: 'chat.widget.message', link: '/website-chats?conversation=42' })).toBe(false);
    expect(websiteChatOf({ link: '/website-chats?conversation=42' })).toBe('42');
    expect(websiteChatOf({ link: '/website-chats/9' })).toBe('9');
    expect(websiteChatOf({ link: '/website-chats?tab=visitors' })).toBeNull();
  });
});
