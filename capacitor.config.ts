import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native shells.
 *
 * `dist/` goes in whole — it is already self-contained and built with
 * relative paths (`base: './'` in `vite.config.ts`), which is what lets the
 * same bundle serve a domain root, a GitHub Pages sub-path and a native
 * shell's `file://` without three builds.
 *
 * WHAT A SHELL ADDS, and it is deliberately little: native networking (no
 * CORS, so the app can import Gen Con's catalogue itself), storage the
 * system does not evict, and the bundled pack snapshot that makes a first
 * launch work with no network at all. Everything else — the map, the
 * search, the router, the schedule — is the same code the website runs.
 *
 * `androidScheme: 'https'` because a native WebView on `http://localhost`
 * is an insecure origin, and `crypto.subtle` — which the pack uses to
 * verify every table it downloads — is unavailable there. Getting this
 * wrong disables the verification rather than announcing itself.
 */
const config: CapacitorConfig = {
  appId: 'com.gencontrip.app',
  appName: 'Gen Con Trip',
  webDir: 'dist',
  android: {
    // A file:// page cannot verify a download; see above.
    initialFocus: false,
  },
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
};

export default config;
