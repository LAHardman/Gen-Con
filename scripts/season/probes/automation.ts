/**
 * Is the automation itself still running — and being listened to?
 *
 * Two probes in one file because they watch the same layer and share the
 * same token. The refresh workflows can stop in two quiet ways: GitHub
 * disables any scheduled workflow after sixty days without repository
 * activity, and a pull request the workflows open can sit unmerged for
 * ever. Neither leaves an error anywhere — a disabled schedule is a
 * setting, an open PR is a normal state — so both have to be *asked after*.
 *
 * Both need a token and a repository, so both run in CI and skip locally.
 */

import type { Probe, ProbeResult } from '../lib';
import { daysBetween, withNetwork } from '../lib';

const API = 'https://api.github.com';

function github(): { repo: string; headers: Record<string, string> } | null {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!repo || !token) return null;
  return {
    repo,
    headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
  };
}

const NEEDS_CI: Omit<ProbeResult, 'status'> = {
  summary: 'no GitHub token in the environment — this probe runs in the weekly workflow',
  instructions: ['Nothing to do locally; `season.yml` provides `GITHUB_TOKEN` when this runs on a schedule.'],
};

export const workflowsProbe: Probe = {
  id: 'workflows',
  title: 'Scheduled workflows still enabled',
  run: (ctx) => {
    const auth = github();
    if (!auth) return Promise.resolve({ status: 'skip', ...NEEDS_CI } satisfies ProbeResult);
    return withNetwork(
      async () => {
        const { status, body } = await ctx.json(`${API}/repos/${auth.repo}/actions/workflows?per_page=100`, auth.headers);
        if (status !== 200) {
          return { status: 'warn', summary: `the workflows API answered HTTP ${status}`, instructions: ['Check the token\'s permissions — `actions: read` is enough to list workflows.'] };
        }
        const workflows = (body as { workflows?: Array<{ name: string; state: string; html_url: string }> })?.workflows ?? [];
        const disabled = workflows.filter((w) => w.state === 'disabled_inactivity');
        if (!disabled.length) {
          return { status: 'ok', summary: `all ${workflows.length} workflows are enabled` };
        }
        return {
          status: 'fail',
          summary: `${disabled.length} workflow${disabled.length === 1 ? '' : 's'} disabled by GitHub for repository inactivity: ${disabled.map((w) => w.name).join(', ')}`,
          repair: disabled.map((w) => `Re-enable with one click: ${w.html_url}`),
          instructions: [
            'Open each link above — the workflow page has an "Enable workflow" button; nothing else is wrong with them.',
            'The weekly season commit normally keeps the 60-day inactivity clock wound; if this fired anyway, the season workflow itself was probably the one disabled first.',
          ],
        };
      },
      { summary: 'api.github.com was unreachable from here', instructions: ['This probe runs in CI, where it always can.'] },
    );
  },
};

export const openDataPrsProbe: Probe = {
  id: 'data-prs',
  title: 'Automation pull requests being merged',
  run: (ctx) => {
    const auth = github();
    if (!auth) return Promise.resolve({ status: 'skip', ...NEEDS_CI } satisfies ProbeResult);
    return withNetwork(
      async () => {
        const { status, body } = await ctx.json(`${API}/repos/${auth.repo}/pulls?state=open&per_page=100`, auth.headers);
        if (status !== 200) {
          return { status: 'warn', summary: `the pulls API answered HTTP ${status}` };
        }
        const pulls = (body as Array<{ title: string; html_url: string; created_at: string; head: { ref: string } }> | null) ?? [];
        const automated = pulls.filter((pr) => /^(data\/|bot\/)/.test(pr.head.ref));
        const waiting = automated
          .map((pr) => ({ ...pr, age: daysBetween(new Date(pr.created_at), ctx.now) }))
          .filter((pr) => pr.age > 14);
        if (!waiting.length) {
          return {
            status: 'ok',
            summary: automated.length
              ? `${automated.length} automation PR${automated.length === 1 ? '' : 's'} open, none older than a fortnight`
              : 'no automation pull requests are waiting',
          };
        }
        return {
          status: 'warn',
          summary: `${waiting.length} automation PR${waiting.length === 1 ? '' : 's'} have waited more than a fortnight — the data in them is stalling`,
          details: waiting.map((pr) => `${pr.age} days: ${pr.title} — ${pr.html_url}`),
          instructions: [
            'Merge them if their checks pass; the refresh workflows already enable auto-merge on a passing refresh, so one waiting this long usually has a failing check worth reading — that failure is how a new year announces itself.',
            'Auto-merge needs "Allow auto-merge" ticked once, under repository Settings → General → Pull Requests.',
          ],
        };
      },
      { summary: 'api.github.com was unreachable from here', instructions: ['This probe runs in CI, where it always can.'] },
    );
  },
};
