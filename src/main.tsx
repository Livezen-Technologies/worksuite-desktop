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
import { initAppState } from './core/app-state';
import { queryClient, wireQueryInvalidation } from './core/query';

void initAppState().then(() => wireQueryInvalidation());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
