import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './registerServiceWorker';
import 'leaflet/dist/leaflet.css';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container #root was not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Last, and only on a built site — see the module for why.
registerServiceWorker();
