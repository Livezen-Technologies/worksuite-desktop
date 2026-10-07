import { useMemo } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { readFrameColours, type FrameColours } from './bodyLook';

/**
 * The app's light and dark colours for an email's frame (worksuite-desktop#287), read from its tokens again whenever
 * the theme, the colour profile or high contrast changes — so the email follows a theme switch at once. The frame is
 * a document of its own and inherits none of the app's CSS.
 */
export function useAppColours(): { appDark: boolean; light: FrameColours; dark: FrameColours } {
  const theme = useStore(app, (s) => s.resolvedTheme);
  const appearance = useStore(app, (s) => s.prefs?.appearance ?? null);
  const highContrast = useStore(app, (s) => s.prefs?.highContrast === true);
  const key = `${theme}|${highContrast ? 1 : 0}|${JSON.stringify(appearance)}`;
  return useMemo(() => ({ appDark: key.startsWith('dark|'), light: readFrameColours('light'), dark: readFrameColours('dark') }), [key]);
}
