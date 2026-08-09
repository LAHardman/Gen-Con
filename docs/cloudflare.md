# Moving the app off GitHub Pages

Everything you need to do, in order. About twenty minutes, all of it free, and
no card at any point.

The goal: **the repository can go private and GitHub Pages can be switched off,
and the app keeps working and keeps updating.**

---

## What is actually moving

GitHub currently does three separate jobs at once. Only one of them is moving.

| job | now | after |
|---|---|---|
| Storing the code | GitHub | **GitHub, private** — unchanged |
| Building the app and fetching the schedule | GitHub Actions | **Cloudflare Pages** |
| Serving the app to phones | GitHub Pages | **Cloudflare Pages** |

Nothing about the app changes. It is the same build, from the same repository,
served by somebody else.

---

## Part 1 — Put the app on Cloudflare Pages

This is the whole migration. Parts 2 and 3 are optional extras.

**1. Make a Cloudflare account.** <https://dash.cloudflare.com/sign-up>. Free
plan, no card.

**2. Connect the repository.**
Workers & Pages → Create → Pages → *Connect to Git*. Authorise Cloudflare for
GitHub and pick this repository. A private repository is fine — that is the
point.

**3. Set the build.** When it asks:

| field | value |
|---|---|
| Framework preset | **None** |
| Build command | `npm run build:pages` |
| Build output directory | `dist` |
| Root directory | *(leave blank)* |

**4. Add one environment variable.** Still on that screen, under *Environment
variables*:

| name | value |
|---|---|
| `NODE_VERSION` | `22` |

**5. Save and Deploy.**

The first build takes about **twelve minutes** — nine of them are
`fetch:events` pulling the whole catalogue from Gen Con. When it finishes you
get a URL like `gen-con-trip.pages.dev`. Open it on your phone and add it to the
home screen.

> Cloudflare's free build timeout is 20 minutes, so the ~12 needed here fits
> with room to spare. If Gen Con ever grows enough to threaten that, the fetcher
> refuses rather than writing a partial schedule, so a build would fail loudly.

**6. Turn GitHub Pages off.** Repository → Settings → Pages → Source: **None**.

**7. Make the repository private.** Settings → General → Danger Zone → Change
visibility. Cloudflare keeps building it; it already has permission.

That is the migration. Everything below is optional.

---

## Part 2 — Keep it rebuilding on a schedule

A push rebuilds automatically. To also refresh the schedule weekly without
pushing anything:

**1.** In your Pages project: Settings → Builds & deployments → **Deploy hooks**
→ Add. Name it `weekly`, branch `main`. Copy the URL it gives you — it is a
secret, anyone with it can trigger a build.

**2.** Anything that can make a POST once a week will do. If you are keeping
GitHub Actions, add the URL as a repository secret named `PAGES_DEPLOY_HOOK` and
`.github/workflows/refresh.yml` can call it. If you are not, use any free cron
service, or just press *Retry deployment* when you think of it.

---

## Part 3 — The mirror, so the schedule outlives everything

Only worth doing if you want the schedule to survive **Cloudflare Pages going
away too**. `worker/wrangler.toml` has the commands; it is a separate Worker
holding a snapshot of `events.json` and serving it with CORS.

Once deployed, add to your Pages project's environment variables:

| name | value |
|---|---|
| `VITE_EVENTS_MIRROR` | `https://<your-worker>.workers.dev/events.json` |

The app then falls back to it if its own origin cannot be reached at all.

---

## What breaks what, afterwards

| if this stops | what happens |
|---|---|
| GitHub Pages off | nothing — that is the point |
| Repository private | nothing — Cloudflare already has access |
| Cloudflare stops building | app keeps working; schedule stops updating |
| Repository deleted | installed phones fine; new phones get the app from the last Pages deploy, which stays up |
| Cloudflare gone entirely | every phone that has opened it once keeps working forever — tested |
| Gen Con changes their API | schedule stops updating; nothing else notices |

The one thing nothing can fix: a phone that has **never** opened the app, once
every host is gone. There is nowhere left to get it from.

---

## What you get that GitHub Pages could not do

A Pages Function — `functions/gencon/[[path]].js` — proxies Gen Con's API on the
app's own origin at `/gencon/api/…`.

That matters because Gen Con sends no `Access-Control-Allow-Origin`, so a
browser cannot read their API directly, and no amount of front-end code changes
that. A same-origin request has no such rule, so on Cloudflare the app can ask
Gen Con questions live — which is what the room dialog's "have these events
moved?" check uses. On GitHub Pages that check could never work, because a
static host cannot proxy.

It is deliberately not a way to rebuild the whole schedule in the browser: that
is ~1,100 requests, and doing it from a phone would be slower, hungrier and
ruder than doing it once at build time.

---

## Costs, honestly

Free, and not marginally: Cloudflare Pages gives 500 builds a month and
unlimited requests and bandwidth, against roughly 5 builds a month here. The
Worker's free plan is 100,000 requests a day against a handful.

Nobody can promise a free tier lasts forever, and I would not. Cloudflare's has
been stable and generous for years, which is why it is the one recommended —
Deno Deploy changed its own in 2025. But the durability of this setup does not
rest on that promise: a phone that has opened the app once keeps working with
every one of these services switched off.
