import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from './app/providers';
import { createAppQueryClient } from './app/queryClient';
import { createAppRouter } from './app/router';
import './ds/tokens.css';
import './ds/global.css';

/** `vite --mode mock` (pnpm dev:mock) serves the API from MSW in the browser; other modes never load it. */
async function enableMocking(): Promise<void> {
  if (import.meta.env.MODE !== 'mock') return;
  const { startMockWorker } = await import('./mocks/msw/browser');
  await startMockWorker();
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('index.html has no #root element');

void enableMocking().then(() => {
  const queryClient = createAppQueryClient();
  const router = createAppRouter({ queryClient });
  createRoot(rootElement).render(
    <StrictMode>
      <AppProviders router={router} queryClient={queryClient} />
    </StrictMode>,
  );
});
