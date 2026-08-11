/**
 * Where to sleep, what it costs, and how you get from it to the hall.
 *
 * FOUR FACTS PER HOTEL, deliberately of different qualities:
 *
 *   skywalk    Gen Con's own, and only for hotels in its block. Nobody else
 *              records it, so a hotel outside the block says nothing rather
 *              than claiming it has none.
 *   journey    a walk time, or a drive time past the point where nobody walks
 *              with a suitcase in August. The drive is arithmetic and marked.
 *   distance   this app's own, exact, and the only number here it is sure of.
 *   price      per person per night, which is a division this app performed
 *              rather than a rate anybody quotes — so the room total is printed
 *              beside it whenever more than one person is sharing.
 *
 * WHERE GEN CON PUBLISHES A PRICE, THAT IS THE PRICE. The block's rates come
 * from Gen Con's own page: free, official, and better than anything a rate API
 * would sell. So the gathering never spends an allowance on a block hotel, and
 * this page shows the published figure instead of a bought one.
 *
 * DISTANCE LEADS, because it is the number this app actually knows. The campus
 * is measured; the non-block prices are second-hand, from free tiers, for a
 * sample night, and every one carries its age and its source.
 *
 * IT WORKS WITH NOTHING. No bought prices at all is the normal starting state,
 * and a plausible steady state if every free tier withdraws — the page is still
 * a distance-ordered list with Gen Con's own rates on two thirds of it.
 */

import { useMemo, useState } from 'react';

import {
  BLOCK_YEAR,
  CAVEAT,
  SOURCE,
  blockRate,
  hasSkywalk,
  journeyTo,
  pairings,
  perPerson,
} from '../data/blocks';
import { planningYear } from '../data/key-dates';
import { LODGING, PULLED, WALK_METRES, type Lodging } from '../data/lodging';
import { CHEAPEST } from '../data/partners';
import { RATES, REFRESHED, rateFor } from '../data/rates';

type Ring = 'walk' | 'drive' | 'block';

/** How many people share the room, and therefore the bill. */
const PARTIES = [1, 2, 3, 4] as const;

const dollars = (amount: number, currency = 'USD') =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 0,
  }).format(amount);

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

/**
 * How you would get to the hall from here.
 *
 * A skywalk is called out rather than folded into a distance, because it is a
 * different experience rather than a shorter one: indoors and air-conditioned,
 * which in an Indianapolis August is the whole difference between two hotels
 * the same distance apart.
 */
function Journey({ place }: { place: Lodging }) {
  const skywalk = hasSkywalk(place.id);
  const journey = journeyTo(place, skywalk === true);
  const km = (place.metres / 1000).toFixed(1);
  return (
    <p className="hotels__where">
      {journey.mode === 'skywalk' && <span className="hotels__skywalk">skywalk</span>}
      {journey.mode === 'drive'
        ? `about ${journey.minutes} min drive`
        : `${journey.minutes} min walk`}
      {journey.rough ? '*' : ''}
      {' · '}
      {place.metres < 1000 ? `${place.metres} m` : `${km} km`} from the ICC
      {place.city && place.city !== 'Indianapolis' ? ` · ${place.city}` : ''}
      {place.kind !== 'hotel' ? ` · ${place.kind.replace('_', ' ')}` : ''}
    </p>
  );
}

/** A price, per head and per room, because those are different claims. */
function Price({
  nightly,
  currency,
  people,
}: {
  nightly: number;
  currency: string;
  people: number;
}) {
  return (
    <>
      <span className="hotels__money">{dollars(perPerson(nightly, people), currency)}</span>
      <span className="hotels__meta">
        per person, per night
        {/* The room total, always, because the per-head figure is a division
            this app performed rather than a rate anybody is quoted. */}
        {people > 1 ? ` · ${dollars(nightly, currency)} the room` : ''}
      </span>
    </>
  );
}

interface Props {
  nowMs: number;
}

export function HotelsView({ nowMs }: Props) {
  const [ring, setRing] = useState<Ring>('walk');
  /*
   * Two, because a room is priced for two and most people travel in pairs — but
   * it is the reader's to change, since no default is right for both a couple
   * and a group of six.
   */
  const [people, setPeople] = useState(2);
  const year = planningYear(nowMs);

  const { rows, unpriced } = useMemo(() => {
    const inRing = LODGING.filter((place) => place.ring === ring).map((place) => {
      const block = blockRate(place.id, year);
      const rate = rateFor(place.id);
      return {
        place,
        block,
        rate,
        // What the page shows and sorts on: Gen Con's published figure where
        // there is one, because it beats anything bought.
        nightly: block?.low ?? rate?.nightly ?? null,
      };
    });

    /*
     * The walk ring lists everything; the drive ring lists only what has a
     * price. A drive-ring hotel with no price is not an option — it is one
     * nobody has asked about, and the only reason to sleep out there is to spend
     * less. The walk ring is the opposite: you would consider walking to any of
     * them at any price, so its blanks are honest and stay visible.
     */
    const shown = ring === 'walk' ? inRing : inRing.filter((one) => one.nightly !== null);
    shown.sort((a, b) => {
      if (ring === 'walk') return a.place.metres - b.place.metres;
      return (a.nightly ?? Infinity) - (b.nightly ?? Infinity);
    });
    return { rows: shown, unpriced: inRing.length - shown.length };
  }, [ring, year]);

  const priced = rows.filter((row) => row.nightly !== null).length;
  const walkable = LODGING.filter((place) => place.ring === 'walk').length;

  return (
    <section className="hotels" aria-label="Hotels">
      <header className="hotels__head">
        <h2>Somewhere to sleep</h2>
        <p>
          {walkable} places within a {(WALK_METRES / 1000).toFixed(1)} km walk of the hall, and{' '}
          {LODGING.length - walkable} more within about a half-hour drive. Distances are this app’s
          own and exact; the prices are not, unless Gen Con published them.
        </p>
      </header>

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

      {/* Sharing changes the answer more than anything else on this page: a
          $296 room is $296 or $74 depending on who is in it. */}
      <div className="hotels__party" role="group" aria-label="Sharing the room">
        <span className="hotels__party-label">Sharing between</span>
        {PARTIES.map((many) => (
          <button
            key={many}
            type="button"
            className={`hotels__person${many === people ? ' hotels__person--on' : ''}`}
            aria-pressed={many === people}
            onClick={() => setPeople(many)}
          >
            {many}
          </button>
        ))}
      </div>

      {ring !== 'block' && (
        <p className="hotels__caution">
          <strong>Rates marked “Gen Con’s own” are the block’s published prices.</strong> Everything
          else is an indicative market rate for a sample night, gathered from free tiers — a rough
          guide rather than a quote for your dates. {CAVEAT}
        </p>
      )}

      {ring === 'drive' && (
        <p className="hotels__note">
          Cheapest first. {unpriced > 0 ? `${unpriced} more out here have no price yet. ` : ''}
          Times marked * are distance divided by a typical speed rather than a routed drive.
        </p>
      )}

      {ring === 'block' ? (
        <BlockTable nowMs={nowMs} people={people} />
      ) : rows.length === 0 ? (
        <p className="hotels__empty">
          {ring === 'drive' ? 'Nothing out here has been priced yet.' : 'No hotels in this ring.'}
        </p>
      ) : (
        <ol className="hotels__list">
          {rows.map(({ place, rate, block, nightly }) => (
            <li key={place.id} className="hotels__row">
              <div className="hotels__what">
                <h3>
                  {place.name}
                  {block && <span className="hotels__inblock">in the block</span>}
                </h3>
                <Journey place={place} />
              </div>
              <div className="hotels__price">
                {nightly === null ? (
                  <span className="hotels__none">no price</span>
                ) : (
                  <>
                    <Price nightly={nightly} currency={rate?.currency ?? 'USD'} people={people} />
                    <span className="hotels__meta">
                      {block
                        ? `Gen Con’s own${block.projected ? ', projected' : ` ${BLOCK_YEAR} rate`}`
                        : `${age(rate!.at, nowMs)}${
                            rate!.spread > 0 ? ` · they differ by ${rate!.spread}` : ''
                          }`}
                    </span>
                    {!block && <span className="hotels__meta">{rate!.sources.join(', ')}</span>}
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {ring !== 'block' && (
        <p className="hotels__note">
          {priced} of {rows.length} priced. Hotels pulled {PULLED} from OpenStreetMap, which caps its
          answers, so this is a sample rather than a complete list. Bought prices last written{' '}
          {REFRESHED}; they are refreshed about once a month per hotel, within the free monthly
          allowances of the services asked, and never spent on a hotel Gen Con publishes.
          {RATES.length === 0 ? '' : ' © OpenStreetMap contributors.'}
        </p>
      )}
    </section>
  );
}

/**
 * The block, beside what you would pay instead.
 *
 * The left column is Gen Con's own published rate — a fact for the year it
 * published, arithmetic for any year after. The right is a market quote. They
 * are not the same kind of number and the labels say so, because a table that
 * lines them up in matching type invites a comparison neither supports alone.
 */
function BlockTable({ nowMs, people }: { nowMs: number; people: number }) {
  const year = planningYear(nowMs);
  const rows = useMemo(() => pairings(year), [year]);
  const projected = rows[0]?.rate.projected ?? false;
  const yearsOn = rows[0]?.rate.yearsOn ?? 0;
  const unpaired = rows.filter((one) => !one.alternative).length;
  const walkable = LODGING.filter((one) => one.ring === 'walk').length;

  if (rows.length === 0) {
    return <p className="hotels__empty">No block hotels are on record.</p>;
  }

  return (
    <>
      <p className="hotels__caution">
        {projected ? (
          <>
            <strong>
              These are Gen Con’s real {BLOCK_YEAR} block rates, carried forward {yearsOn}{' '}
              {yearsOn === 1 ? 'year' : 'years'}.
            </strong>{' '}
            Gen Con has not published {year} yet, so each figure is its {BLOCK_YEAR} rate grown at
            the rate this block’s own prices have actually moved — about 2.8% a year, measured
            against 2019.
          </>
        ) : (
          <>
            <strong>These are Gen Con’s published {BLOCK_YEAR} block rates.</strong> Not estimates,
            not market prices — what Gen Con charges.
          </>
        )}{' '}
        {CAVEAT}{' '}
        <a href={SOURCE} target="_blank" rel="noreferrer noopener">
          Gen Con’s hotel list ↗
        </a>
      </p>

      <ol className="hotels__list">
        {rows.map(({ partner, rate, alternative, alternativeRate, apart, saving }) => (
          <li key={partner.id} className="hotels__pair">
            <div className="hotels__side">
              <span className="hotels__label">
                In the block{rate.projected ? ' · projected' : ` · ${BLOCK_YEAR}`}
              </span>
              <h3>{partner.name}</h3>
              <span className={`hotels__money${rate.projected ? ' hotels__money--guess' : ''}`}>
                {dollars(perPerson(rate.low, people))}
                {/* Both ends. Only the low one would make the block look cheaper
                    than anybody pays for it. */}
                {rate.high !== null && rate.high !== rate.low
                  ? `–${dollars(perPerson(rate.high, people))}`
                  : ''}
              </span>
              <span className="hotels__meta">
                per person{people > 1 ? ` · ${dollars(rate.low)} the room` : ''}
              </span>
              <Journey place={partner} />
            </div>

            <div className="hotels__side">
              <span className="hotels__label">Nearest outside it</span>
              {alternative ? (
                <>
                  <h3>{alternative.name}</h3>
                  {alternativeRate ? (
                    <span className="hotels__money">
                      {dollars(perPerson(alternativeRate.nightly, people), alternativeRate.currency)}
                    </span>
                  ) : (
                    <span className="hotels__none">no price yet</span>
                  )}
                  <span className="hotels__meta">
                    {apart} m from it{alternativeRate ? ` · ${age(alternativeRate.at, nowMs)}` : ''}
                  </span>
                  <Journey place={alternative} />
                </>
              ) : (
                <span className="hotels__none">
                  every nearby hotel outside the block is already somebody else’s comparison
                </span>
              )}
            </div>

            {saving !== null && (
              <p className={`hotels__saving${saving > 0 ? '' : ' hotels__saving--worse'}`}>
                {saving > 0
                  ? `About ${dollars(perPerson(saving, people))} a night each cheaper outside the block`
                  : `About ${dollars(perPerson(-saving, people))} a night each dearer outside the block`}
                <span>
                  {' '}
                  — and the block rate is before tax while the other is a market quote, so treat it
                  as a direction, not a sum.
                </span>
              </p>
            )}
          </li>
        ))}
      </ol>

      <p className="hotels__note">
        {rows.length} of Gen Con’s block are hotels this app can place on its map; the rest are left
        out rather than guessed at, because putting one hotel’s block rate on another is the one
        mistake here that would cost money. No hotel is offered as an alternative twice — where two
        block hotels want the same neighbour, the nearer keeps it and the other takes its next
        choice.
      </p>

      {unpaired > 0 && (
        <p className="hotels__note">
          <strong>{unpaired} of them have no comparison at all</strong>, and that is the finding
          rather than a gap: {rows.length} of the {walkable} hotels within a walk of the hall are in
          Gen Con’s block, so there is very little downtown left to compare against. If you want to
          pay less, the block’s own outlying hotels are the realistic answer, not a walkable one
          outside it.
        </p>
      )}

      <p className="hotels__note">
        The block reaches well past downtown: its cheapest room anywhere is{' '}
        <strong>{dollars(CHEAPEST.low)}</strong> at {CHEAPEST.blockName}, {CHEAPEST.distance} away —
        published by Gen Con, and so costing this app no API quota at all.
      </p>
    </>
  );
}
