import { lazy } from 'react';
import { showFromHash } from './protocol';

const SlideShowWindow = lazy(() => import('./SlideShowWindow').then((m) => ({ default: m.SlideShowWindow })));
const PresenterWindow = lazy(() => import('./SlideShowWindow').then((m) => ({ default: m.PresenterWindow })));

/** The slideshow's windows (#321), by their address; their code loads only in them. */
export function SlideShowRoot({ hash }: { hash: string }) {
  const show = showFromHash(hash);
  if (!show) return null;
  return show.role === 'presenter' ? <PresenterWindow id={show.id} /> : <SlideShowWindow id={show.id} />;
}
