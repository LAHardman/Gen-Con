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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  BLOCK_YEAR,
  CAVEAT,
  SOURCE,
  blockRate,
  hasSkywalk,
  journeyTo,
  pairings,
  perPerson,
  tier,
} from '../data/blocks';
import { planningYear } from '../data/key-dates';
import { DRIVE_METRES, LODGING, PULLED, WALK_METRES, type Lodging } from '../data/lodging';
import { CHEAPEST } from '../data/partners';
import { RATES, REFRESHED, rateFor, type Rate } from '../data/rates';

/** How far, and where the price comes from. Null in either means "don't mind". */
type Ring = 'walk' | 'drive';
type Source = 'block' | 'third';
type Sort = 'distance' | 'price' | 'rating';

/** How many people share the room, and therefore the bill. */
const PARTIES = [1, 2, 3, 4] as const;

/**
 * WHAT "RATING" MEANS HERE, AND WHAT IT DOES NOT.
 *
 * There is no rating. OpenStreetMap carries a `stars` tag and not one of the
 * two hundred and fifty places within twenty-five kilometres of the hall has it
 * filled in, and no guest reviews have been gathered by anything this app runs.
 * So sorting by rating orders on the one quality signal the data has — the
 * chain each name belongs to, read against the usual industry scale — and every
 * row says which band it landed in while that sort is on, so the ordering is
 * legible rather than mysterious and nobody reads it as a score out of five.
 */
const CLASSES = ['economy', 'midscale', 'upscale', 'upper upscale', 'luxury'];

/**
 * The top of each slider, which means "no limit" rather than its own number.
 *
 * Without the distinction the page opens claiming a filter nobody set — "within
 * 25 km" reads as a choice — and a hotel with no price falls out of a list
 * whose price cap was never applied.
 */
const FURTHEST_KM = Math.round(DRIVE_METRES / 1000);
const DEAREST = 320;

const dollars = (amount: number, currency = 'USD') =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 0,
  }).format(amount);

/** "1.5", "3" — a half-kilometre is worth showing, a trailing zero is not. */
const trim = (km: number) => km.toFixed(1).replace(/\.0$/, '');

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
function Journey({ place, band }: { place: Lodging; band?: string | null }) {
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
      {/* Shown only while it is doing the ordering, so it never sits on the
          page looking like a fact somebody recorded about the hotel. */}
      {band ? ` · ${band}` : ''}
    </p>
  );
}

/**
 * What a price is, in one breath, for the number itself to say.
 *
 * Three kinds of number sit in this column — a published rate, a projection of
 * one, a market quote of unknown age — and this used to be a box at the top of
 * the page explaining all three at once. A box like that is read once and then
 * passed; attached to the number, the explanation is there the moment it is the
 * number somebody is looking at.
 */
function priceStory(
  row: { block: ReturnType<typeof blockRate>; rate: Rate | null; nightly: number | null },
  nowMs: number,
): string {
  const { block, rate, nightly } = row;
  if (nightly === null) {
    return 'No price. Nobody has gathered a market rate for this one yet, and Gen Con publishes none. It is not a sign it is dear or cheap.';
  }
  if (block?.projected) {
    return (
      `An estimate. Gen Con’s real ${BLOCK_YEAR} block rate of ${dollars(block.from.low)} the room, ` +
      `carried forward ${block.yearsOn} ${block.yearsOn === 1 ? 'year' : 'years'} at the rate this ` +
      `block’s own prices have actually moved since 2019. ${CAVEAT}`
    );
  }
  if (block) {
    return `Gen Con’s published ${BLOCK_YEAR} block rate. Not an estimate and not a market price — what Gen Con charges. ${CAVEAT}`;
  }
  return (
    `A market rate, not a quote. An indicative price for a sample night from ` +
    `${rate!.sources.join(' and ')}, gathered ${age(rate!.at, nowMs)}` +
    `${rate!.spread > 0 ? `, and they differ by ${dollars(rate!.spread)}` : ''}. ` +
    `It is not a price for your dates, and Gen Con has no block here.`
  );
}

/**
 * Something that explains itself when you look at it.
 *
 * Hover and focus and tap all open it, because those are the three ways people
 * reach a thing; moving away, tapping elsewhere, scrolling or pressing Escape
 * all close it. Positioned against the viewport and closed on scroll rather
 * than followed, which is cheaper and reads as intentional.
 */
function Told({ say, children }: { say: string; children: React.ReactNode }) {
  const [at, setAt] = useState<{ top: number; right: number; below: boolean } | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);

  const open = useCallback(() => {
    const box = anchor.current?.getBoundingClientRect();
    if (!box) return;
    // Above the number when there is no room under it, which on a phone is
    // most of the time for anything in the bottom third of the list.
    const below = box.bottom + 150 < window.innerHeight;
    setAt({
      top: below ? box.bottom + 8 : box.top - 8,
      right: Math.max(10, window.innerWidth - box.right),
      below,
    });
  }, []);

  const shut = useCallback(() => setAt(null), []);

  useEffect(() => {
    if (!at) return;
    const away = (event: Event) => {
      if (!anchor.current?.contains(event.target as Node)) shut();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') shut();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', shut, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', shut, true);
    };
  }, [at, shut]);

  return (
    <span
      ref={anchor}
      className="hotels__told"
      tabIndex={0}
      role="button"
      aria-label={say}
      onMouseEnter={open}
      onMouseLeave={shut}
      onFocus={open}
      onBlur={shut}
      // Opens, never toggles. With a mouse the hover has already opened it, and
      // a click that closed it again would read as the page refusing to answer.
      onClick={open}
    >
      {children}
      {at && (
        <span
          className={`hotels__bubble${at.below ? '' : ' hotels__bubble--above'}`}
          role="status"
          style={{ top: at.top, right: at.right }}
        >
          {say}
        </span>
      )}
    </span>
  );
}

interface Props {
  nowMs: number;
}

export function HotelsView({ nowMs }: Props) {
  /*
   * Every filter starts off, and every one turns off the same way it turned on.
   *
   * There were three tabs — walk, drive, block — which is a filter pretending to
   * be a place. It made the block a distance, so a hotel could not be both in
   * Gen Con's block and a drive away when plenty of them are; and it gave no way
   * to see everything at once, because one tab was always chosen.
   */
  const [ring, setRing] = useState<Ring | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [skywalkOnly, setSkywalkOnly] = useState(false);
  const [withinKm, setWithinKm] = useState(FURTHEST_KM);
  const [upto, setUpto] = useState(DEAREST);
  const [sort, setSort] = useState<Sort>('distance');
  /*
   * Two, because a room is priced for two and most people travel in pairs — but
   * it is the reader's to change, since no default is right for both a couple
   * and a group of six.
   */
  const [people, setPeople] = useState(2);
  const year = planningYear(nowMs);

  /** How many filters are on. Sorting and sharing are not filters. */
  const onNow = [
    ring !== null,
    source !== null,
    skywalkOnly,
    withinKm < FURTHEST_KM,
    upto < DEAREST,
  ].filter(Boolean).length;

  const rows = useMemo(() => {
    const all = LODGING.map((place) => {
      const block = blockRate(place.id, year);
      const rate = rateFor(place.id);
      return {
        place,
        block,
        rate,
        source: block ? ('block' as const) : rate ? ('third' as const) : null,
        // What the page shows and sorts on: Gen Con's published figure where
        // there is one, because it beats anything bought.
        nightly: block?.low ?? rate?.nightly ?? null,
        // Gen Con is the only source for this, so a hotel outside the block
        // says nothing rather than claiming it has none.
        skywalk: hasSkywalk(place.id) === true,
      };
    });

    const shown = all
      .filter((one) => ring === null || one.place.ring === ring)
      .filter((one) => source === null || one.source === source)
      .filter((one) => !skywalkOnly || one.skywalk)
      .filter((one) => one.place.metres <= withinKm * 1000)
      /*
       * A price cap hides the hotels with no price at all.
       *
       * The alternative is to read "unknown" as "cheap enough", which puts a
       * hotel nobody has a number for at the top of a list somebody built to see
       * what they can afford. Asking for a budget is asking about prices.
       */
      .filter(
        (one) =>
          upto >= DEAREST || (one.nightly !== null && perPerson(one.nightly, people) <= upto),
      );

    /*
     * Three orders, and each puts its unknowns last. A hotel with no price at
     * the top of "cheapest first" would be the page answering a question about
     * money with the one row it has no money for.
     */
    const each = (nightly: number | null) =>
      nightly === null ? Infinity : perPerson(nightly, people);
    shown.sort((a, b) => {
      if (sort === 'price') return each(a.nightly) - each(b.nightly);
      if (sort === 'rating') {
        return tier(b.place) - tier(a.place) || a.place.metres - b.place.metres;
      }
      return a.place.metres - b.place.metres;
    });
    return shown;
  }, [ring, source, skywalkOnly, withinKm, upto, sort, people, year]);

  const priced = rows.filter((row) => row.nightly !== null).length;
  const walkable = LODGING.filter((place) => place.ring === 'walk').length;

  /** What the filters currently say, in the order the controls are in. */
  const words = [
    ring === null ? null : ring === 'walk' ? 'within walking distance' : 'a drive away',
    source === null ? null : source === 'block' ? 'in Gen Con’s block' : 'outside the block',
    skywalkOnly ? 'on a skywalk to the hall' : null,
    withinKm < FURTHEST_KM ? `within ${trim(withinKm)} km of the hall` : null,
    upto < DEAREST ? `up to ${dollars(upto)} each a night` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const clear = () => {
    setRing(null);
    setSource(null);
    setSkywalkOnly(false);
    setWithinKm(FURTHEST_KM);
    setUpto(DEAREST);
  };

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

      <div className="hotels__rings" role="group" aria-label="Travel distance">
        <span className="hotels__party-label">Travel distance</span>
        {(['walk', 'drive'] as const).map((which) => (
          <Chip
            key={which}
            on={which === ring}
            // Pressing the pressed one is the way back to everything.
            onClick={() => setRing(which === ring ? null : which)}
          >
            {which === 'walk' ? 'Walking distance' : 'Driving distance'}
          </Chip>
        ))}
      </div>

      <div className="hotels__rings" role="group" aria-label="Source">
        <span className="hotels__party-label">Source</span>
        {(['block', 'third'] as const).map((which) => (
          <Chip
            key={which}
            on={which === source}
            onClick={() => setSource(which === source ? null : which)}
          >
            {which === 'block' ? 'Gen Con block' : 'Third party'}
          </Chip>
        ))}
      </div>

      <div className="hotels__rings" role="group" aria-label="Access">
        <span className="hotels__party-label">Access</span>
        <Chip on={skywalkOnly} onClick={() => setSkywalkOnly(!skywalkOnly)}>
          Skywalk to the ICC
        </Chip>
      </div>

      <Slider
        id="hotels-within"
        label="Distance"
        min={0}
        max={FURTHEST_KM}
        step={0.5}
        unit="km"
        value={withinKm}
        onChange={setWithinKm}
        say={(km) => `${trim(km)} km`}
      />

      <Slider
        id="hotels-upto"
        label="Price"
        min={20}
        max={DEAREST}
        step={5}
        unit="$ each"
        value={upto}
        onChange={setUpto}
        say={(amount) => `${dollars(amount)} ea`}
      />

      <div className="hotels__rings" role="group" aria-label="Sort by">
        <span className="hotels__party-label">Sort by</span>
        {(['distance', 'price', 'rating'] as const).map((which) => (
          // Not a filter — a list is always in some order, so this one does not
          // toggle off and does not count towards the clear-all button.
          <Chip key={which} on={which === sort} onClick={() => setSort(which)}>
            {which[0].toUpperCase() + which.slice(1)}
          </Chip>
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

      {/* One filter comes off by pressing it again; the button is for the mess.
          Below two it repeats what a chip already says. */}
      {onNow >= 2 && (
        <div>
          <button type="button" className="hotels__clear" onClick={clear}>
            Clear all filters
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="hotels__empty">No hotel is {words}.</p>
      ) : (
        <ol className="hotels__list">
          {rows.map(({ place, rate, block, nightly }) => (
            <li key={place.id} className="hotels__row">
              <div className="hotels__what">
                <h3>
                  {place.name}
                  {block && <span className="hotels__inblock">in the block</span>}
                </h3>
                <Journey place={place} band={sort === 'rating' ? CLASSES[tier(place)] : null} />
              </div>
              <div className="hotels__price">
                <Told say={priceStory({ block, rate, nightly }, nowMs)}>
                  {nightly === null ? (
                    <span className="hotels__none">no price</span>
                  ) : (
                    <span
                      className={`hotels__money${block?.projected ? ' hotels__money--guess' : ''}`}
                    >
                      {dollars(perPerson(nightly, people), rate?.currency ?? 'USD')}
                    </span>
                  )}
                </Told>
                {nightly !== null && (
                  <>
                    <span className="hotels__meta">
                      per person, per night
                      {/* The room total, always, because the per-head figure is
                          a division this app performed rather than a rate
                          anybody is quoted. */}
                      {people > 1 ? ` · ${dollars(nightly, rate?.currency ?? 'USD')} the room` : ''}
                    </span>
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

      <p className="hotels__note">
        {onNow > 0
          ? `${rows.length} of ${LODGING.length} hotels are ${words}, ${priced} of them priced. `
          : `${priced} of ${rows.length} priced. `}
        Tap a price to see where it came from.{' '}
        {/* Said only while that sort is on, because otherwise it explains a
            control nobody has touched. */}
        {sort === 'rating'
          ? 'No guest ratings have been gathered and OpenStreetMap records no star grades here, so “rating” orders by the chain each name belongs to. '
          : ''}
        {/* The asterisk is explained wherever a drive time is on screen to
            carry one, and nowhere else, since it would be explaining nothing. */}
        {rows.some((one) => one.place.ring === 'drive')
          ? 'Times marked * are distance divided by a typical speed rather than a routed drive. '
          : ''}
        Hotels pulled {PULLED} from OpenStreetMap, which caps its answers, so this is a sample rather
        than a complete list. Bought prices last written {REFRESHED}; they are refreshed about once a
        month per hotel, within the free monthly allowances of the services asked, and never spent on
        a hotel Gen Con publishes.
        {RATES.length === 0 ? '' : ' © OpenStreetMap contributors.'}
      </p>

      {/* The comparison belongs wherever block hotels are in view, and it
          answers the distance filters rather than living behind a tab. */}
      {source !== 'third' && (
        <BlockTable nowMs={nowMs} people={people} ring={ring} withinKm={withinKm} />
      )}
    </section>
  );
}

/** A filter chip that turns itself off. */
function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`hotels__ring${on ? ' hotels__ring--on' : ''}`}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * A slider whose top end means "no limit" rather than its own number.
 *
 * So the readout says "any" where nothing has been chosen, which is both what
 * the reader means and what stops the page looking filtered before it is.
 */
function Slider({
  id,
  label,
  min,
  max,
  step,
  unit,
  value,
  onChange,
  say,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  value: number;
  onChange: (value: number) => void;
  say: (value: number) => string;
}) {
  const [typing, setTyping] = useState<string | null>(null);
  const off = value >= max;

  /*
   * The reading is the other way in. A slider is fine for "about a kilometre"
   * and useless for "exactly 1.2", and somebody who knows their budget should
   * be able to say it rather than hunt for it with a thumb.
   */
  const commit = (text: string) => {
    setTyping(null);
    const asked = Number(text);
    /*
     * An empty box means "no limit" rather than zero. Somebody clearing the
     * field is undoing the filter, and reading that as "under $0" would empty
     * the page in answer to a gesture that meant the opposite.
     */
    if (text.trim() === '' || !Number.isFinite(asked)) return onChange(max);
    onChange(Math.min(max, Math.max(min, asked)));
  };

  return (
    <div className="hotels__slider">
      <label className="hotels__party-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        // The range snaps whatever it is given to its own step, so a typed 1.2
        // would come back as 1. The thumb is the coarse control and rounds; the
        // value the page filters on is the one held above.
        value={Math.min(max, Math.max(min, value))}
        aria-describedby={`${id}-out`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {typing === null ? (
        <button
          type="button"
          id={`${id}-out`}
          className={`hotels__reading${off ? ' hotels__any' : ''}`}
          aria-label={`${label} limit, ${off ? 'any' : say(value)}. Click to type a number`}
          onClick={() => setTyping(off ? '' : String(value))}
        >
          {off ? 'any' : say(value)}
        </button>
      ) : (
        <input
          type="number"
          className="hotels__typed"
          aria-label={`${label} limit in ${unit}`}
          min={min}
          max={max}
          step={step}
          placeholder={unit}
          value={typing}
          autoFocus
          onChange={(event) => setTyping(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit((event.target as HTMLInputElement).value);
            if (event.key === 'Escape') setTyping(null);
          }}
        />
      )}
    </div>
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
function BlockTable({
  nowMs,
  people,
  ring,
  withinKm,
}: {
  nowMs: number;
  people: number;
  ring: Ring | null;
  withinKm: number;
}) {
  const year = planningYear(nowMs);
  /*
   * The distance filters apply; the price cap does not.
   *
   * A cap is a question about what to book. This is a question about what a
   * block hotel is worth, and hiding the dear half of it would leave the reader
   * with only the half that agrees with them.
   */
  const rows = useMemo(
    () =>
      pairings(year)
        .filter((one) => ring === null || one.partner.ring === ring)
        .filter((one) => one.partner.metres <= withinKm * 1000),
    [year, ring, withinKm],
  );
  const projected = rows[0]?.rate.projected ?? false;
  const yearsOn = rows[0]?.rate.yearsOn ?? 0;
  const shared = rows.filter((one) => one.shared).length;
  /*
   * Mark the shared rows only when that tells the rows apart.
   *
   * Downtown is so nearly all block that every row usually leans on a shared
   * alternative, and a label on every row is not a label — it is a word the eye
   * learns to skip. When it is true of everything, the note below says it once.
   */
  const marksShared = shared > 0 && shared < rows.length;
  const walkable = LODGING.filter((one) => one.ring === 'walk').length;

  if (rows.length === 0) return null;

  return (
    <>
      <h3 className="hotels__pairhead">Beside the nearest alternative</h3>

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
        {rows.map(({ partner, rate, alternative, alternativeRate, apart, saving, shared: isShared }) => (
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
              {/* `alternative` is null only when no non-block hotel is within
                  reach at all. The type says it can be, so the guard stays. */}
              {alternative && (
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
                    {/* Two rows naming the same hotel are one finding, not two. */}
                    {marksShared && isShared ? ' · also stands in for others' : ''}
                  </span>
                  <Journey place={alternative} />
                </>
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
        mistake here that would cost money. Where two block hotels want the same neighbour, the
        nearer keeps it and the other takes its next choice.
      </p>

      {shared > 0 && (
        <p className="hotels__note">
          <strong>
            {shared} of these lean on an alternative another block hotel is compared against too
          </strong>
          , and that is the finding rather than a gap: {rows.length} of the {walkable} hotels within
          a walk of the hall are in Gen Con’s block, so there is very little downtown left to compare
          against. Each alternative carries an even share of the block rather than the first few
          taking the nearest one. If you want to pay less, the block’s own outlying hotels are the
          realistic answer, not a walkable one outside it.
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
