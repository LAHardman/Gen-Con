/**
 * The season check: every way this app goes stale, asked after in one run.
 *
 *     npm run season:check                    all probes, report written
 *     npm run season:check -- --fix           probes may run their own repairs
 *     npm run season:check -- --probe dates   one probe, by id
 *     npm run season:check -- --json          machine-readable, for the workflow
 *     npm run season:check -- --no-report     don't touch docs/season-report.md
 *
 * Each probe answers with the same three layers — what is true, what
 * self-repair found by reading the live pages, and the exact steps for a
 * person — so the report is never "something is wrong" without also being
 * "and here is the fix, started". The weekly workflow (`season.yml`) commits
 * the report, which doubles as the repository activity that keeps GitHub
 * from disabling the scheduled workflows, and opens an issue carrying the
 * attention sections when anything is not `ok`.
 *
 * Run through tsx so the probes can import the app's own tables —
 * the check reads the same `FOOD_TAGS` and `BLOCK_YEAR` the app ships,
 * rather than a second copy that can drift.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Probe, ProbeResult } from './lib';
import { makeContext, weekStamp } from './lib';

import { probe as feedFields } from './probes/feed-fields';
import { probe as locations } from './probes/locations';
import { probe as dates } from './probes/dates';
import { probe as basemaps } from './probes/basemaps';
import { probe as campusTiles } from './probes/campus-tiles';
import { probe as blockRates } from './probes/block-rates';
import { probe as blockPartyHours } from './probes/blockparty-hours';
import { probe as parking } from './probes/parking';
import { probe as badgePrices } from './probes/badge-prices';
import { probe as osmAge } from './probes/osm-age';
import { probe as foodTags } from './probes/food-tags';
import { probe as mirror } from './probes/mirror';
import { workflowsProbe, openDataPrsProbe } from './probes/automation';
import { probe as storeDates } from './probes/store-dates';
import { probe as boothAgreement } from './probes/booth-agreement';

/** Slowest and network-heaviest last, local file reads first. */
const PROBES: Probe[] = [
  storeDates,
  foodTags,
  osmAge,
  parking,
  badgePrices,
  feedFields,
  dates,
  blockRates,
  blockPartyHours,
  campusTiles,
  basemaps,
  locations,
  mirror,
  workflowsProbe,
  openDataPrsProbe,
  boothAgreement,
];

const REPORT = 'docs/season-report.md';
const BADGE: Record<ProbeResult['status'], string> = { ok: '✓ ok', warn: '⚠ warn', fail: '✗ FAIL', skip: '– skip' };

interface Finding extends ProbeResult {
  id: string;
  title: string;
}

function section(finding: Finding): string {
  const lines = [`### ${finding.title} — ${BADGE[finding.status]}`, '', finding.summary, ''];
  if (finding.details?.length) {
    lines.push('What was seen:', '', ...finding.details.map((d) => `- ${d}`), '');
  }
  if (finding.repair?.length) {
    lines.push('What self-repair found:', '');
    for (const r of finding.repair) lines.push(r.startsWith('```') || r.startsWith('  ') ? r : `- ${r}`);
    lines.push('');
  }
  if (finding.instructions?.length) {
    lines.push('To fix:', '', ...finding.instructions.map((i, n) => `${n + 1}. ${i}`), '');
  }
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const has = (flag: string) => args.includes(flag);
  const only = (() => {
    const at = args.indexOf('--probe');
    return at === -1 ? null : new Set((args[at + 1] ?? '').split(',').filter(Boolean));
  })();

  const ctx = makeContext({ fix: has('--fix'), root: process.cwd() });
  const chosen = only ? PROBES.filter((p) => only.has(p.id)) : PROBES;
  if (only && !chosen.length) {
    console.error(`No probe matches. Known: ${PROBES.map((p) => p.id).join(', ')}`);
    process.exit(1);
  }

  const findings: Finding[] = [];
  for (const probe of chosen) {
    if (!has('--json')) console.error(`… ${probe.id}`);
    let result: ProbeResult;
    try {
      result = await probe.run(ctx);
    } catch (error) {
      result = {
        status: 'fail',
        summary: `the probe itself threw — a bug in scripts/season/probes/, not in the data it watches`,
        details: [error instanceof Error ? (error.stack ?? error.message) : String(error)],
      };
    }
    findings.push({ id: probe.id, title: probe.title, ...result });
    if (!has('--json')) console.error(`  ${BADGE[result.status]}  ${result.summary}`);
    // Their servers: a beat between probes that go out.
    await new Promise((done) => setTimeout(done, 250));
  }

  const week = weekStamp(ctx.now);
  const attention = findings.filter((f) => f.status === 'fail' || f.status === 'warn');
  const attentionMarkdown = attention.length
    ? attention.map(section).join('\n')
    : 'Nothing needs attention.';

  const report = [
    `# Season report — ${week}`,
    '',
    'Written by `npm run season:check` (see `scripts/season/`). Regenerated weekly',
    'by the season workflow; the commit is also what keeps the scheduled workflows',
    "inside GitHub's 60-day activity window.",
    '',
    '| Probe | Status | Summary |',
    '| --- | --- | --- |',
    ...findings.map((f) => `| ${f.title} | ${BADGE[f.status]} | ${f.summary.replace(/\|/g, '\\|')} |`),
    '',
    '## Needs attention',
    '',
    attentionMarkdown,
    '',
  ].join('\n');

  if (!has('--no-report') && !only) {
    const path = join(ctx.root, REPORT);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, report);
    if (!has('--json')) console.error(`\nReport written to ${REPORT}`);
  }

  if (has('--json')) {
    console.log(
      JSON.stringify(
        {
          week,
          counts: {
            fail: findings.filter((f) => f.status === 'fail').length,
            warn: findings.filter((f) => f.status === 'warn').length,
            skip: findings.filter((f) => f.status === 'skip').length,
            ok: findings.filter((f) => f.status === 'ok').length,
          },
          attention: attentionMarkdown,
          results: findings,
        },
        null,
        2,
      ),
    );
  } else {
    const { length: fails } = findings.filter((f) => f.status === 'fail');
    const { length: warns } = findings.filter((f) => f.status === 'warn');
    console.error(
      fails || warns
        ? `\n${fails} to fix, ${warns} to watch — the report has the instructions.`
        : '\nNothing needs attention.',
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
