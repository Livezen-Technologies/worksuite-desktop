import { Fragment, useMemo, type ReactNode } from 'react';
import { parseMarkdown, type MdBlock, type MdInline, type MdList } from '../core/markdown';
import { openAnyLink, splitLinks } from './LinkedText';
import { cx } from './ui';

/**
 * An answer written in Markdown, drawn (worksuite-desktop#150): the tree core/markdown parses, made into React
 * elements — never HTML from the text, so nothing in it can become markup. Web addresses in the words are links too,
 * and every link opens the way the rest of WorkSuite's do (openAnyLink).
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className={cx('flex flex-col gap-2 break-words', className)}>{blocks.map((b, i) => <Block key={i} b={b} />)}</div>;
}

const HEADING = ['text-[15px]', 'text-[14.5px]', 'text-[14px]'];

function Block({ b }: { b: MdBlock }): ReactNode {
  switch (b.t) {
    case 'p':
      return (
        <p className="m-0">
          {b.lines.map((l, i) => (
            <Fragment key={i}>
              {i ? <br /> : null}
              <Inline c={l} />
            </Fragment>
          ))}
        </p>
      );
    case 'h':
      return (
        <p role="heading" aria-level={Math.min(b.level + 2, 6)} className={cx('m-0 font-bold text-ink', HEADING[b.level - 1] ?? 'text-[13.5px]')}>
          <Inline c={b.c} />
        </p>
      );
    case 'list':
      return <List l={b} />;
    case 'code':
      return <pre className="m-0 overflow-x-auto rounded-[8px] bg-subtle px-3 py-2 font-mono text-[12px] leading-[1.5] whitespace-pre text-ink scroll-thin">{b.v}</pre>;
    case 'quote':
      return (
        <blockquote className="m-0 flex flex-col gap-2 border-l-2 border-line pl-3 text-ink-2">
          {b.c.map((x, i) => (
            <Block key={i} b={x} />
          ))}
        </blockquote>
      );
    case 'hr':
      return <hr className="my-1 border-line" />;
  }
}

function List({ l }: { l: MdList }) {
  const items = l.items.map((it, i) => (
    <li key={i} className="pl-0.5">
      <Inline c={it.c} />
      {it.sub ? <List l={it.sub} /> : null}
    </li>
  ));
  return l.ordered ? (
    <ol start={l.start} className="m-0 flex list-decimal flex-col gap-1 pl-5">
      {items}
    </ol>
  ) : (
    <ul className="m-0 flex list-disc flex-col gap-1 pl-5">{items}</ul>
  );
}

function Inline({ c }: { c: MdInline[] }) {
  return (
    <>
      {c.map((x, i) => {
        switch (x.t) {
          case 'text':
            return (
              <Fragment key={i}>
                {splitLinks(x.v).map((p, j) => (p.href ? <Link key={j} href={p.href}>{p.text}</Link> : <Fragment key={j}>{p.text}</Fragment>))}
              </Fragment>
            );
          case 'code':
            return (
              <code key={i} className="rounded-[4px] bg-subtle px-1 py-px font-mono text-[0.9em]">
                {x.v}
              </code>
            );
          case 'strong':
            return (
              <strong key={i} className="font-bold">
                <Inline c={x.c} />
              </strong>
            );
          case 'em':
            return (
              <em key={i}>
                <Inline c={x.c} />
              </em>
            );
          case 'del':
            return (
              <del key={i}>
                <Inline c={x.c} />
              </del>
            );
          case 'link':
            return (
              <Link key={i} href={x.href}>
                <Inline c={x.c} />
              </Link>
            );
        }
      })}
    </>
  );
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      title={href}
      onClick={(e) => {
        e.preventDefault();
        openAnyLink(href);
      }}
      className="text-primary underline underline-offset-2 hover:no-underline"
    >
      {children}
    </a>
  );
}
