# Where the app icons come from

`logo.svg` is the source; `npm run icons` regenerates every size the two
stores want — 74 Android densities, 7 iOS, adaptive icons and splash
screens, light and dark — into `android/app/src/main/res/` and
`ios/App/App/Assets.xcassets/`. Those outputs are committed, because a
store build must not depend on a generator having been run.

**It is destructive to `public/`, and the npm script undoes that.**
`capacitor-assets` also generates a PWA icon set and rewrites
`public/manifest.webmanifest` to point at it — which silently replaces the
website's own icons with a set that is not there once the stray directory
is cleaned up. The web app's icons are hand-made and referenced by that
manifest, so the script restores both afterwards. If you run
`capacitor-assets` by hand, run `git checkout public/` after it.

Backgrounds are `#101820`, the app's own dark ground, so the icon sits on
the same colour the map does rather than on a white square.
