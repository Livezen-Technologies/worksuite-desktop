/** Stable context shared by the attention protocol and route reporters. */
export function notificationContext(link: string | null): string {
  if (!link) return '';
  try {
    const url = new URL(link, 'https://worksuite.invalid');
    const website = url.searchParams.get('website');
    const room = url.searchParams.get('room');
    const ticket = url.pathname.match(/\/(?:support\/tickets?|tickets)\/(\d+)/)?.[1] ?? url.searchParams.get('ticket');
    const mail = url.pathname.match(/\/mail\/m\/(\d+)\/(\d+)/);
    const mbx = url.searchParams.get('mbx');
    const msg = url.searchParams.get('msg');
    if (mbx && msg) return `mail:${mbx}:${msg}`;
    if (mail) return `mail:${mail[1]}:${mail[2]}`;
    if (website) return `website:${website}`;
    if (room) return `chat:${room}`;
    if (ticket) return `ticket:${ticket}`;
    return '';
  } catch { return ''; }
}
