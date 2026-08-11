/**
 * Where to sleep, and what it costs.
 *
 * THE PRICES ARE THE LEAST TRUSTWORTHY THING ON THIS PAGE and it is laid out
 * accordingly. They come from free tiers of commercial services, they are
 * indicative rates for a sample night rather than a quote for your dates, and
 * the number everybody actually wants — the Gen Con block rate — is behind a
 * badge purchase and a login and cannot be fetched at all. So every price
 * carries its age and who said it, a disagreement between two services is shown
 * rather than averaged away, and the block rate gets a line of its own saying it
 * is missing. A confident-looking table of prices that quietly omits the cheapest
 * one available is worse than no table.
 *
 * DISTANCE IS THE TRUSTWORTHY THING, so it leads. This app knows the campus
 * exactly; it knows hotel prices roughly and second-hand. Ordering by walk
 * first, and only then by price, matches which of those two numbers deserves to
 * decide anything.
 *
 * IT WORKS WITH NOTHING. No prices at all is the normal starting state and a
 * plausible steady state if every service withdraws its free tier — so the page
 * is a useful distance-ordered list of hotels before a single rate exists, and
 * says what is missing rather than showing a column of blanks.
 */

import { useMemo, useState } from 'react';

import { BASE_YEAR, SOURCE, pairings } from '../data/blocks';
import { planningYear } from '../data/key-dates';
import { LODGING, PULLED, WALK_METRES, type Lodging } from '../data/lodging';
import { isPartner } from '../data/partners';
import { RATES, REFRESHED, rateFor, type Rate } from '../data/rates';

type Ring = 'walk' | 'drive' | 'block';

/** Metres to "9 min", at the pace this app already walks everywhere else. */
const WALK_METRES_PER_MIN = 78;
const walkMinutes = (metres: number) => Math.max(1, Math.round(metres / WALK_METRES_PER_MIN));

/**
 * Roughly how long the drive is.
 *
 * Openly a division, not a route. It is here because "14 km" means nothing to
 * somebody deciding where to sleep and "about 21 min" means something — and it
 * is rounded to five minutes so it cannot be mistaken for a routed answer.
 */
const driveMinutes = (metres: number) => Math.max(5, Math.round(metres / 1000 / 0.7 / 5) * 5);

const dollars = (amount: number, currency = 'USD') =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);

const money = (rate: Rate) => dollars(rate.nightly, rate.currency || 'USD');

/** "3 weeks ago", so a stale price looks stale. */
function age(at: string, nowMs: number): string {
  const days = Math.floor((nowMs - Date.parse(at)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return 'just now';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

interface Props {
  nowMs: number;
}

export function HotelsView({ nowMs }: Props) {
  const [ring, setRing] = useState<Ring>('walk');

  const { rows, unpriced } = useMemo(() => {
    const inRing = LODGING.filter((place) => place.ring === ring).map((place) => ({
      place,
      rate: rateFor(place.id),
    }));

    /*
     * The walk ring lists everything; the drive ring lists only what has a
     * price.
     *
     * Because a drive-ring hotel with no price is not an option — it is a
     * hotel nobody has asked about yet. The only reason to sleep out there is
     * to spend less, and anything collected out there is by construction at or
     * under the cheapest walkable rate, so a price is what *makes* it a
     * candidate. Two hundred unpriced names would bury the handful that are.
     *
     * The walk ring is the opposite: you would consider walking to any of them
     * at any price, so an unpriced one is still worth seeing and its blank is
     * honest.
     */
    const shown = ring === 'walk' ? inRing : inRing.filter((one) => one.rate);
    shown.sort((a, b) => {
      // Walk ring by distance, which is the number this app is sure of. Drive
      // ring by price, which is the only reason to be out there.
      if (ring === 'walk') return a.place.metres - b.place.metres;
      return (a.rate?.nightly ?? Infinity) - (b.rate?.nightly ?? Infinity);
    });
    return { rows: shown, unpriced: inRing.length - shown.length };
  }, [ring]);

  const priced = rows.filter((row) => row.rate).length;
  const walkable = LODGING.filter((place) => place.ring === 'walk').length;

  return (
    <section className="hotels" aria-label="Hotels">
      <header className="hotels__head">
        <h2>Somewhere to sleep</h2>
        <p>
          {walkable} places within a {(WALK_METRES / 1000).toFixed(1)} km walk of the hall, and{' '}
          {LODGING.length - walkable} more within about a half-hour drive. Distances are this app’s
          own and exact; the prices are not.
        </p>
      </header>

      {/* Said once, at the top, where a decision gets made — not in a footnote
          under a table somebody has already read. Not on the block tab, which
          is showing block rates and where "these are not block rates" would be
          flatly contradicting the thing above it. */}
      {ring !== 'block' && (
      <p className="hotels__caution">
        <strong>These are not Gen Con block rates.</strong> The block is booked through Gen Con’s
        housing portal, opens 157 days before the convention, and is usually cheaper than anything
        here — its prices are behind a badge purchase and a login and cannot be read by any app.
        Treat the figures below as a rough guide to what the open market is charging.
      </p>
      )}

      <div className="hotels__rings" role="group" aria-label="How far">
        {(['walk', 'drive', 'block'] as const).map((which) => (
          <button
            key={which}
            type="button"
            className={`hotels__ring${which === ring ? ' hotels__ring--on' : ''}`}
            aria-pressed={which === ring}
            onClick={() => setRing(which)}
          >
            {which === 'walk'
              ? 'Walking distance'
              : which === 'drive'
                ? 'Within a drive'
                : 'Gen Con block'}
          </button>
        ))}
      </div>

      {ring === 'drive' && (
        <p className="hotels__note">
          Only places quoted at or below the cheapest walkable rate are listed here — the point of a
          drive is to save money, so one that does not is not worth the drive.{' '}
          {unpriced > 0 &&
            `${unpriced} more are within range and have not been priced yet; they are asked about a few at a time, cheapest-looking first, as the monthly allowances permit. `}
          “About {driveMinutes(8000)} min” and the like are distance divided by a typical speed, not
          a routed time.
        </p>
      )}

      {ring === 'block' ? (
        <BlockTable nowMs={nowMs} />
      ) : rows.length === 0 ? (
        <p className="hotels__empty">
          {ring === 'drive'
            ? 'Nothing out here has been priced yet, so there is nothing worth driving to that this app knows about.'
            : 'No hotels in this ring.'}
        </p>
      ) : (
        <ol className="hotels__list">
          {rows.map(({ place, rate }) => (
            <li key={place.id} className="hotels__row">
              <div className="hotels__what">
                <h3>{place.name}</h3>
                <p className="hotels__where">
                  {ring === 'walk'
                    ? `${walkMinutes(place.metres)} min walk · ${place.metres} m`
                    : `about ${driveMinutes(place.metres)} min drive · ${(place.metres / 1000).toFixed(1)} km`}
                  {/* Only where it says something: every walkable hotel is in
                      Indianapolis and repeating it 35 times is noise. */}
                  {place.city && place.city !== 'Indianapolis' ? ` · ${place.city}` : ''}
                  {place.kind !== 'hotel' ? ` · ${place.kind.replace('_', ' ')}` : ''}
                </p>
              </div>
              <div className="hotels__price">
                {rate ? (
                  <>
                    <span className="hotels__money">{money(rate)}</span>
                    <span className="hotels__meta">
                      per night · {age(rate.at, nowMs)}
                      {/* Two services disagreeing is the honest width of the
                          number, and hiding it would make it look surer. */}
                      {rate.spread > 0 ? ` · they differ by ${rate.spread}` : ''}
                    </span>
                    <span className="hotels__meta">{rate.sources.join(', ')}</span>
                  </>
                ) : (
                  <span className="hotels__none">no price</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {ring !== 'block' && (
      <p className="hotels__note">
        {priced === 0
          ? 'No prices have been collected yet. The list above is still ordered and still useful; run scripts/fetch-rates.mjs to fill the right-hand column.'
          : `${priced} of ${rows.length} priced. Prices are refreshed about once a month per place, within the free monthly allowances of the services asked — so a figure here can be weeks old, and says so.`}
        {' '}Hotels pulled {PULLED} from OpenStreetMap, which caps its answers, so this is a sample
        rather than a complete list. Prices last written {REFRESHED}.
        {RATES.length === 0 ? '' : ' © OpenStreetMap contributors.'}
      </p>
      )}
    </section>
  );
}

/**
 * The block, estimated, beside what you would pay instead.
 *
 * TWO NUMBERS OF VERY DIFFERENT QUALITY SIT SIDE BY SIDE HERE, which is the
 * whole difficulty. The left is a real 2019 negotiated rate multiplied by a
 * published index; the right is a market rate somebody quoted this month. They
 * are not the same kind of fact and the column headings say so, because a table
 * that lines them up in matching type invites a comparison neither supports on
 * its own.
 *
 * The alternative is never the same hotel twice — see `pairings`. A table where
 * one Hampton Inn is the alternative to six different hotels tells you one thing
 * six times, and the fix is a matching rather than a lookup.
 */
function BlockTable({ nowMs }: { nowMs: number }) {
  const year = planningYear(nowMs);
  const rows = useMemo(() => pairings(year), [year]);
  const measured = rows[0]?.estimate.measured ?? false;
  const missing = LODGING.filter(
    (place) => place.ring === 'walk' && !isPartner(place.id),
  ).length;

  if (rows.length === 0) {
    return <p className="hotels__empty">No block hotels are on record.</p>;
  }

  return (
    <>
      <p className="hotels__caution">
        <strong>Every figure in the left column is an estimate.</strong> Gen Con publishes no block
        rates anywhere a program can read, so these are the real {BASE_YEAR} block rates — from{' '}
        <a href={SOURCE} target="_blank" rel="noreferrer noopener">
          a table an attendee posted on Gen Con’s forums
        </a>{' '}
        — carried forward by a published hotel-price index.{' '}
        {measured
          ? `For ${year} that index is measured: US hotel prices were 13% above ${BASE_YEAR} in mid-2026.`
          : `For ${year} the index is itself projected past the last measured year, so this is an estimate built on an estimate.`}{' '}
        The block changed hands to Q-rooms for 2026 and its hotel list will not be identical.
      </p>

      <ol className="hotels__list">
        {rows.map(({ partner, estimate, alternative, alternativeRate, apart, saving }) => (
          <li key={partner.id} className="hotels__pair">
            <div className="hotels__side">
              <span className="hotels__label">In the block · estimated</span>
              <h3>{partner.name}</h3>
              <span className="hotels__money hotels__money--guess">
                {dollars(estimate.nightly)}
              </span>
              <span className="hotels__meta">
                from {dollars(estimate.from.nightly)} in {estimate.from.year} ·{' '}
                {walkMinutes(partner.metres)} min walk
              </span>
            </div>

            <div className="hotels__side">
              <span className="hotels__label">Nearest outside it</span>
              {alternative ? (
                <>
                  <h3>{alternative.name}</h3>
                  {alternativeRate ? (
                    <span className="hotels__money">{money(alternativeRate)}</span>
                  ) : (
                    <span className="hotels__none">no price yet</span>
                  )}
                  <span className="hotels__meta">
                    {apart} m away · {walkMinutes(alternative.metres)} min walk
                    {alternativeRate ? ` · ${age(alternativeRate.at, nowMs)}` : ''}
                  </span>
                </>
              ) : (
                // Better than repeating somebody else's alternative.
                <span className="hotels__none">
                  every nearby hotel outside the block is already somebody else’s comparison
                </span>
              )}
            </div>

            {saving !== null && (
              <p className={`hotels__saving${saving > 0 ? '' : ' hotels__saving--worse'}`}>
                {saving > 0
                  ? `About ${dollars(saving)} a night cheaper outside the block`
                  : `About ${dollars(-saving)} a night dearer outside the block`}
                <span> — comparing an estimate with a quote, so treat it as a direction, not a sum.</span>
              </p>
            )}
          </li>
        ))}
      </ol>

      <p className="hotels__note">
        {rows.length} of the {BASE_YEAR} block matched to this app’s hotel list; the rest are left
        out rather than guessed at, because putting one hotel’s block rate on another is the one
        mistake here that would cost money. Alternatives are drawn from the {missing} walkable
        hotels not in the block, and no hotel is offered twice — where two block hotels want the
        same neighbour, the nearer keeps it and the other takes its next choice.
      </p>
    </>
  );
}

export type { Lodging };
