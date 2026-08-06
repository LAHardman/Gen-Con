/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The path the app re-checks event locations through.
 *
 * The event database sends no `access-control-allow-origin`, so a browser
 * cannot read it directly — which is why the schedule ships as a generated
 * file in the first place. A same-origin path that forwards to it lifts that
 * restriction, because the browser is then talking to its own origin.
 *
 * The dev server provides it below. A static host does not, and the app treats
 * its absence as "can't check right now" rather than as an error. To have the
 * check work on a deployed copy, give this path the same forwarding: on
 * Netlify a redirect to `https://gencon.eventdb.us/:splat`, on Cloudflare
 * Pages a function, on nginx a `proxy_pass`.
 */
export const EVENT_DB_PROXY = '/eventdb';

// `base: './'` keeps the build portable: it works when served from a domain
// root, from a sub-path (GitHub Pages), or from a native shell's file:// bundle.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: true,
    port: 5173,
    proxy: {
      [EVENT_DB_PROXY]: {
        target: 'https://gencon.eventdb.us',
        changeOrigin: true,
        rewrite: (path) => path.replace(new RegExp(`^${EVENT_DB_PROXY}`), ''),
      },
    },
  },
  /*
   * Tests run under Vitest, which reads this file — so they get the same
   * plugins, resolution and aliases the app is built with, and there is one
   * build configuration rather than two that can drift apart.
   *
   * jsdom throughout rather than per-file environments: the pure modules don't
   * care which environment they are in, and the components and hooks all need a
   * document. Tests live next to the code they cover.
   */
  test: {
    environment: 'jsdom',
    // The scripts are plain JavaScript and are tested where they live, next to
    // the code, rather than being given hand-written declarations to be
    // importable from `src`.
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    // A stubbed geolocation or timer in one file must not leak into the next.
    restoreMocks: true,
    unstubGlobals: true,
  },
});
