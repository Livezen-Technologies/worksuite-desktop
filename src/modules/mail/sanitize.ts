/**
 * Mail bodies are untrusted HTML. They are rendered in a sandboxed iframe
 * with no scripts and no same-origin access, under the shell's CSP; this pass
 * removes what should never reach even that frame, forces links to open in
 * the browser (through the shell's allow-list and confirmation), and blocks
 * remote images, which are how senders learn you opened a message.
 */
const DROP = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'textarea', 'select', 'meta', 'link', 'base', 'svg', 'math', 'template', 'noscript', 'audio', 'video'];

export interface SanitizedMail {
  html: string;
  blockedImages: number;
}

export function sanitizeMailHtml(input: string): SanitizedMail {
  const doc = new DOMParser().parseFromString(input || '', 'text/html');
  for (const tag of DROP) doc.querySelectorAll(tag).forEach((el) => el.remove());
  let blockedImages = 0;
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction' || name === 'ping') el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src' || name === 'action' || name === 'xlink:href' || name === 'background') && /^\s*(javascript|vbscript|data:text\/html)/i.test(value)) el.removeAttribute(attr.name);
      else if (name === 'style' && /expression\(|url\(\s*['"]?\s*(https?:|\/\/)/i.test(value)) el.setAttribute('style', value.replace(/url\([^)]*\)/gi, 'none'));
    }
  });
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    if (/^(https?:)?\/\//i.test(src)) {
      img.removeAttribute('src');
      img.removeAttribute('srcset');
      img.setAttribute('alt', img.getAttribute('alt') || '[image blocked]');
      blockedImages++;
    }
  });
  doc.querySelectorAll('a').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  doc.querySelectorAll('style').forEach((s) => {
    s.textContent = (s.textContent ?? '').replace(/@import[^;]+;/gi, '').replace(/url\([^)]*\)/gi, 'none');
  });
  return { html: doc.body.innerHTML, blockedImages };
}

/** The frame document: light background (mail expects it), readable defaults. */
export function mailFrameDoc(bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#fff;color:#151A2D;font:14px/1.55 'Plus Jakarta Sans Variable',system-ui,sans-serif;word-wrap:break-word}
    body{padding:4px 2px 24px}
    img{max-width:100%;height:auto}
    a{color:#23349E}
    blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #E3E6EE;color:#4A5168}
    table{max-width:100%}
    pre{white-space:pre-wrap}
  </style></head><body>${bodyHtml}</body></html>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Plain text typed in the composer → the HTML body WorkSuite sends. */
export function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br>');
}

export function parseAddresses(input: string): string[] {
  return input
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
