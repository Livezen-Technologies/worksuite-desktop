/** The person's own words and the quoted email below them (worksuite-desktop#53). */
export function splitQuote(body: string, quote?: string): [string, string] {
  if (quote && body.endsWith(quote)) return [body.slice(0, body.length - quote.length), quote];
  const m = /\n\nOn [^\n]* wrote:\n>/.exec(body);
  return m ? [body.slice(0, m.index), body.slice(m.index)] : [body, ''];
}

export function joinQuote(own: string, quoted: string): string {
  return quoted ? `${own.trimEnd()}${quoted}` : own;
}

/** The quoted email as plain lines. */
export function unquote(quote: string): string {
  return quote
    .replace(/^\s+/, '')
    .split('\n')
    .map((l) => l.replace(/^> ?/, ''))
    .join('\n')
    .trim();
}
