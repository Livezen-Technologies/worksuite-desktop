import { useId, useState } from 'react';
import type { ServerCapabilities } from '../../../../core/capabilities';
import { call, errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { toast } from '../../../../core/toasts';
import { Note } from '../../../../components/CardKit';
import { versionNotice, type CommFeature } from './serverSupport';

/**
 * The small notice at the top of a website chat page for whoever can change widgets (worksuite-desktop#259):
 * "Behaviour and Insights need Communication module 2.4 or later (server has 2.3.1). Update server · Learn more".
 * Update server opens the server's own update page, and only when the server says this person may use it; Learn more
 * says what the gap means. Nothing at all while the server has everything.
 */
export function ServerNotice({ missing, caps }: { missing: CommFeature[]; caps: ServerCapabilities | null }) {
  const [more, setMore] = useState(false);
  const id = useId();
  if (!missing.length) return null;
  const update = caps?.updatePath ?? null;
  const link = 'font-semibold underline hover:no-underline';
  return (
    <Note tone="amber" className="shrink-0">
      <section aria-label={text('Server update needed')}>
        <p className="flex flex-wrap items-center gap-x-1.5">
          <span>{versionNotice(missing, caps?.versions.communication)}</span>
          {update ? (
            <>
              <button type="button" className={link} onClick={() => void call('app:openInBrowser', { path: update }).catch((e) => toast('error', errorMessage(e)))}>
                {text('Update server')}
              </button>
              <span aria-hidden>·</span>
            </>
          ) : null}
          <button type="button" className={link} aria-expanded={more} aria-controls={id} onClick={() => setMore((m) => !m)}>
            {text('Learn more')}
          </button>
        </p>
        <p id={id} hidden={!more} className="mt-1.5">
          {text('This app is newer than the Communication module on your WorkSuite server, so these screens are not available until the module is updated. People who cannot change widgets do not see them at all, and visitors keep the widget as it is set up now.')}{' '}
          {update ? null : text('Ask whoever runs your WorkSuite server to update it.')}
        </p>
      </section>
    </Note>
  );
}
