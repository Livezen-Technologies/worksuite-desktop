/**
 * Just enough XML for WebDAV multistatus answers (RFC 4918, 6352, 6578): elements by local name (the `d:`, `D:`,
 * `card:` prefixes CardDAV servers use differ and do not matter here), text with entities and CDATA decoded.
 * Processing instructions, comments and doctypes are skipped. It does not validate; a malformed answer gives a
 * partial tree, and the caller treats what is missing as missing.
 */
export interface XmlNode {
  name: string;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const local = (qname: string) => qname.slice(qname.indexOf(':') + 1).toLowerCase();

export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#root', children: [], text: '' };
  const stack: XmlNode[] = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<\s*([^\s/>]+)([^>]*?)(\/?)>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) {
      const name = local(m[2]);
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.name === name) {
          stack.length = i;
          break;
        }
      }
    } else if (m[3] !== undefined) {
      const node: XmlNode = { name: local(m[3]), children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += decodeEntities(m[6]);
  }
  return root;
}

/** Every descendant with this local name, depth first. */
export function all(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

export function first(node: XmlNode, name: string): XmlNode | undefined {
  return all(node, name)[0];
}

export function textOf(node: XmlNode | undefined): string {
  return node ? node.text.trim() : '';
}
