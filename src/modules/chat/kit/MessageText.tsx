import { useMemo } from 'react';
import { hasMarkdown } from '../../../core/markdown';
import { LinkedText } from '../../../components/LinkedText';
import { Markdown } from '../../../components/Markdown';
import { cx } from '../../../components/ui';
import { shortUrl } from './LinkPreview';

/** On our own indigo bubble (its links white): inline code and quotes lightened, so they stay readable. */
const ON_INDIGO = '[&_blockquote]:border-white/50 [&_blockquote]:text-white/85 [&_code]:bg-white/20';

/**
 * A message's words in its bubble. Web addresses are links, shortened, as ever. Where the channel formats its messages
 * (`caps.markdown`: website chats, worksuite-desktop#261), words written in Markdown — a saved reply, an assistant's
 * draft, the bot's answer — are drawn formatted: **bold**, lists, [links](https://…), `code`, by the same parser and
 * component as the assistant's answers, never as HTML. Words without any Markdown are drawn exactly as before.
 */
export function MessageText({ text, accent, markdown = false }: { text: string; accent: string; markdown?: boolean }) {
  const formatted = useMemo(() => markdown && hasMarkdown(text), [markdown, text]);
  if (!formatted) {
    return (
      <span>
        <LinkedText text={text} className={accent} display={shortUrl} />
      </span>
    );
  }
  return <Markdown text={text} linkClassName={accent} className={cx(accent === 'text-white' && ON_INDIGO)} />;
}
