import type { ReactNode } from 'react';

/** The one input style the till's screens use: big enough for a shop floor and a finger. */
export const field = 'h-11 rounded-[10px] border border-line bg-surface px-3.5 text-[15px] text-ink outline-none focus:border-primary';

/** A centred card, for the screens that are one thing: setting up, signing in, opening the register. */
export function Panel({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex flex-col items-center gap-4">
        <div className="text-center">
          <h1 className="m-0 text-[26px] font-extrabold text-ink">{title}</h1>
          {sub ? <p className="m-0 mt-1.5 max-w-[420px] text-[13.5px] leading-[1.55] text-ink-3">{sub}</p> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
