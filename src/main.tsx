import { isGuestMeetingHash } from '@shared/guest-meet';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/noto-sans-sinhala/400.css';
import '@fontsource/noto-sans-tamil/400.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import { AppBoundary } from './app/Boundaries';
import { initAppState } from './core/app-state';
import { wireSessionCache } from './core/session';
import { wireTooltips } from './core/tooltips';
import { wireUpdatePrepare } from './core/update-restart';
import { queryClient, wireQueryInvalidation } from './core/query';

if (!isGuestMeetingHash(window.location.hash)) void initAppState().then(() => {
  wireQueryInvalidation();
  // Guest mode and each account keep their own data: switching between them leaves nothing cached behind (#149).
  wireSessionCache();
  // Before an update's restart: drafts and tabs are written now (worksuite-desktop#205).
  wireUpdatePrepare();
});

// Every `title` is shown as the app's own tooltip, which never stays on screen (worksuite-desktop#285).
wireTooltips();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppBoundary>
        <App />
      </AppBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
