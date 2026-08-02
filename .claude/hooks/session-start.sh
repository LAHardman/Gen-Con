#!/bin/bash
#
# Bring a fresh Claude Code on the web session up to where it can build.
#
# The container is cloned from the repository and nothing else, so node_modules
# does not exist and `npm run build`, `npm run typecheck` and `npm run dev` all
# fail until something installs the dependencies. That something is this.
#
set -euo pipefail

# A local checkout manages its own dependencies; only the web sessions start
# from an empty container.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-"$(dirname "$0")/../.."}"

# `npm install`, not `npm ci`: the container is cached once this hook finishes,
# so an install that reuses whatever is already there beats one that deletes
# node_modules and starts over.
if npm_output=$(npm install --no-audit --no-fund 2>&1); then
  echo "Dependencies installed."
else
  echo "$npm_output" | tail -20
  echo
  echo "npm install failed — node_modules is missing or incomplete, so"
  echo "'npm run build', 'npm run typecheck' and 'npm run dev' will not work."
  if echo "$npm_output" | grep -qE '\b(E?403|host_not_allowed)\b'; then
    echo
    echo "The registry returned 403. registry.npmjs.org is very likely missing"
    echo "from this environment's network egress allowlist — check with:"
    echo "  curl -sS https://registry.npmjs.org/ -o /dev/null -w '%{http_code}\\n'"
    echo "and add the host in the environment's network settings if it is 403."
    echo "See https://code.claude.com/docs/en/claude-code-on-the-web"
  fi
  # Deliberately not a failure: a session that can still read code, run the
  # plan scripts and push commits is far more use than one that refuses to
  # start because a registry was unreachable.
fi

# The schedule is generated rather than committed (see .gitignore), so a fresh
# clone has none and the app comes up empty. The sample feed is written offline
# and is tagged as fake throughout; a real one fetched with `npm run
# fetch:events` is left alone.
if [ ! -f public/events.json ]; then
  node scripts/make-sample-events.mjs >/dev/null
  echo "Wrote a sample public/events.json — replace it with: npm run fetch:events"
fi
