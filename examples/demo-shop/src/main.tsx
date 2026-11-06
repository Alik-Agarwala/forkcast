import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createForkcast } from 'forkcast';
import { mountDevtools } from 'forkcast/devtools';
import { ForkcastProvider } from 'forkcast/react';
import { App } from './App';
import './style.css';

// ---------------------------------------------------------------------------
// 1. Create ONE client for the whole app.
//    - In dev (vite dev server) we use the development key: overrides and the
//      devtools panel are enabled.
//    - In a production build we use the production key: overrides are ignored.
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);

const forkcast = createForkcast({
  apiUrl: import.meta.env.VITE_FORKCAST_URL ?? 'http://localhost:4400',
  clientKey: import.meta.env.DEV ? 'fc_dev_demo_key' : 'fc_prod_demo_key',
  devMode: import.meta.env.DEV,
  user: {
    id: params.get('user') ?? localStorage.getItem('demo:userId') ?? undefined, // falls back to an anonymous id
    country: params.get('country') ?? localStorage.getItem('demo:country') ?? 'IN',
    platform: 'web',
  },
});

// 2. Optional: floating panel to flip treatments while developing.
mountDevtools(forkcast);

// Handy for poking around in the browser console: window.forkcast.getTreatment('new-checkout')
(window as unknown as { forkcast: typeof forkcast }).forkcast = forkcast;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ForkcastProvider client={forkcast}>
      <App />
    </ForkcastProvider>
  </StrictMode>,
);
