import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadStoredPack, refreshPack } from './data/pack-store';
import { stashPack } from './data/pack-runtime';
import 'leaflet/dist/leaflet.css';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container #root was not found');

/**
 * The pack, then the app — in that order, and the order is the feature.
 *
 * The data modules initialise from a table synchronously at import, so a
 * stored pack newer than the compiled snapshot has to be stashed before any
 * of them load — which is why `App` arrives by dynamic import below rather
 * than at the top of this file, where the import would be hoisted ahead of
 * the stash. The cost is one cache read (single-digit milliseconds) before
 * the first paint; the alternative is a refresh that can never actually be
 * applied.
 *
 * Every step degrades to the snapshot: a failed cache read stashes nothing,
 * and the app is complete on what it shipped with — the floor a copy that
 * never updates again stands on for ever. The refresh runs last, after
 * render, and stores for the *next* launch; nothing moves under a mounted
 * map.
 */
(async () => {
  try {
    stashPack(await loadStoredPack());
  } catch {
    // The snapshot is the floor; nothing to do.
  }

  const [{ default: App }, { registerServiceWorker }] = await Promise.all([
    import('./App'),
    import('./registerServiceWorker'),
  ]);

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // Last, and only on a built site — see the module for why.
  registerServiceWorker();
  void refreshPack();
})();
