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
  beside,
  blockRate,
  hasSkywalk,
  journeyTo,
  perPerson,
  tier,
  type Beside,
} from '../data/blocks';
import { conventionDaysOf, conventionWednesday, planningYear } from '../data/key-dates';
import { DRIVE_METRES, LODGING, PULLED, WALK_METRES, type Lodging } from '../data/lodging';
import { CHEAPEST } from '../data/partners';
import { LISTINGS } from '../data/listings';
import { RATES, REFRESHED, STAY, rateFor, type Rate, type Stay } from '../data/rates';
import type { Booking } from '../data/bookings';
import type { Bookings } from '../hooks/useBookings';

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
    return 'No price. Nobody has gathered a market rate for this one yet, and Gen Con publishes none. It is not a sign it is expensive or cheap.';
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
  /*
   * A price with no rate record behind it is a listing: somewhere the price
   * search knows about that no survey does, carrying the only figure anybody
   * has for it. It has no second source to disagree with and no separate age —
   * it is as old as the gathering that found it.
   */
  if (!rate) {
    return (
      'A listed price, from the search that found this place. It is somewhere let by ' +
      'the night rather than a surveyed hotel, so there is one source and no second ' +
      'opinion, and it is not a quote for your dates.'
    );
  }
  return (
    `A market rate, not a quote. An indicative price for a sample night from ` +
    `${rate!.sources.join(' and ')}, gathered ${age(rate!.at, nowMs)}` +
    `${rate!.spread > 0 ? `, and they differ by ${dollars(rate!.spread)}` : ''}. ` +
    `It is not a price for your dates, and Gen Con has no block here.`
  );
}

/**
 * Where you would actually book this, when anybody has said.
 *
 * Gen Con's block is booked through Gen Con and nowhere else — that is what
 * being in the block means — so a block hotel points at Gen Con's own housing
 * page rather than at the hotel's front desk, which cannot sell you the rate on
 * the row above.
 *
 * Everything else depends on the search having returned a link, and until the
 * gathering of 2026-08 nothing captured one. So the common answer is that there
 * is no link yet, and the page says that rather than inventing a search URL and
 * calling it a booking.
 */
export function bookingFor(row: {
  block: ReturnType<typeof blockRate>;
  rate: Rate | null;
  listing?: { link?: string | null } | null;
}): { href: string; label: string } | null {
  if (row.block) return { href: SOURCE, label: 'Book through Gen Con’s housing' };
  const link = row.listing?.link ?? row.rate?.link ?? null;
  return link ? { href: link, label: 'Where this was listed' } : null;
}

/** What the dialog needs to say everything about one hotel. */
export interface HotelRow {
  place: Lodging;
  block: ReturnType<typeof blockRate>;
  rate: Rate | null;
  listing?: { link?: string | null } | null;
  nightly: number | null;
  beside: Beside | null;
}

/**
 * One hotel, opened out — the summary and the rest of it in a single reading.
 *
 * This was a fold under the row, which put the answer in the middle of the list
 * and pushed every hotel below it down the page. Somebody comparing two hotels
 * ended up scrolling between two expanded rows with the second one moving as
 * the first opened. A dialog holds still, has room for the whole story at once,
 * and closes back to exactly the place in the list they left.
 *
 * IT OPENS ON THE COMPARISON TOO. A block hotel's row names a cheaper place
 * beside it, and until now that name was the end of the road: no distance
 * beyond one number, no source, nothing about booking. Now it is a way in, and
 * the dialog it opens is the same dialog, because it is the same question.
 */
function HotelDialog({
  row,
  people,
  nowMs,
  stay,
  booked,
  onBook,
  onClose,
  onShow,
}: {
  row: HotelRow;
  people: number;
  nowMs: number;
  /** The nights a new booking would be for — the convention's own. */
  stay: { in: string; out: string };
  /** This hotel's booking, if it has one. */
  booked: Booking | null;
  onBook: () => void;
  onClose: () => void;
  onShow: (placeId: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const { place, block, rate, nightly, beside: alt } = row;
  const booking = bookingFor(row);
  const skywalk = hasSkywalk(place.id) === true;

  useEffect(() => {
    closeRef.current?.focus();
  }, [place.id]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  return (
    <div className="dialog__backdrop" onPointerDown={onClose}>
      <div
        className="dialog hotels__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hotel-dialog-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__header">
          <span className="dialog__tag hotels__dialog-tag">
            {block ? 'In Gen Con’s block' : place.kind === 'rental' ? 'Let by the night' : 'Third party'}
          </span>
          <button
            ref={closeRef}
            type="button"
            className="dialog__close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <h2 className="dialog__title" id="hotel-dialog-title">
          {place.name}
        </h2>

        <p className="hotels__dialog-price">
          {nightly === null ? (
            <span className="hotels__none">No price gathered</span>
          ) : (
            <>
              <span className="hotels__money">{dollars(perPerson(nightly, people), rate?.currency ?? 'USD')}</span>
              <span className="hotels__meta">
                per person, per night
                {people > 1 ? ` · ${dollars(nightly, rate?.currency ?? 'USD')} the room` : ''}
              </span>
            </>
          )}
        </p>
        {/* The same sentence the price bubble carries in the list, said here
            without having to be asked for. */}
        <p className="hotels__dialog-story">{priceStory({ block, rate, nightly }, nowMs)}</p>

        <dl className="hotels__detail hotels__detail--dialog">
          <div>
            <dt>Which nights</dt>
            <dd>
              {block
                ? 'Gen Con’s block rate, for the convention itself'
                : STAY.in
                  ? STAY.isConvention
                    ? `${STAY.in} to ${STAY.out}, the convention itself`
                    : `${STAY.in} to ${STAY.out} — Gen Con ${STAY.conventionYear} is not on sale yet, so this is the same Wednesday to Sunday in a quieter week and the real thing will cost more`
                  : 'No nights gathered yet'}
            </dd>
          </div>
          <div>
            <dt>Getting to the hall</dt>
            <dd>
              {place.metres < 1000
                ? `${place.metres} m from the convention centre`
                : `${trim(place.metres / 1000)} km from the convention centre`}
              {`, ${journeyTo(place, skywalk).mode === 'drive' ? `about ${journeyTo(place, skywalk).minutes} minutes' drive` : `${journeyTo(place, skywalk).minutes} minutes' walk`}`}
              {skywalk ? ', on the skywalk, so it is indoors all the way.' : '.'}
              {/* Only when it is somewhere else. "It is in Indianapolis" under
                  a hotel 124 m from the hall is a sentence that says nothing,
                  and the row has always left it out for the same reason. */}
              {place.city && place.city !== 'Indianapolis' ? ` It is in ${place.city}.` : ''}
              {place.kind === 'rental'
                ? ' Let by the night rather than a hotel, so there is no front desk.'
                : ''}
            </dd>
          </div>
          <div>
            <dt>How to book</dt>
            <dd>
              {booking ? (
                <a href={booking.href} target="_blank" rel="noreferrer noopener">
                  {booking.label} ↗
                </a>
              ) : (
                'No booking link gathered for this one.'
              )}
            </dd>
          </div>
          {rate && (
            <div>
              <dt>Where the price came from</dt>
              <dd>
                {rate.sources.join(' and ')}, gathered {age(rate.at, nowMs)}
                {rate.spread > 0 ? `, and they differ by ${dollars(rate.spread)}` : ''}.
              </dd>
            </div>
          )}
        </dl>

        {/*
          Booking is a note to yourself, not a reservation.
          ------------------------------------------------
          Nothing here can book a room: Gen Con's block is behind a badge and a
          login, and every other price on this page came from a search engine.
          What this does is record that you have booked it somewhere else, so
          the budget stops being a page you have to keep in step by hand. The
          wording says so, because a button that reads "Book" on a page full of
          prices would be read as one that books.
        */}
        <div className="hotels__dialog-book">
          <button
            type="button"
            className={`hotels__book${booked ? ' hotels__book--on' : ''}`}
            aria-pressed={!!booked}
            onClick={onBook}
            disabled={nightly === null}
          >
            {booked ? 'Booked — in your budget' : 'I have booked this'}
          </button>
          <p className="hotels__book-note">
            {nightly === null
              ? 'No price gathered for this one, so there is nothing for the budget to add up.'
              : booked
                ? `${booked.in} to ${booked.out}, at ${dollars(booked.nightlyCents / 100, rate?.currency ?? 'USD')} a night. Change the nights, or who is in the room, on the Budget page.`
                : `Records it against ${stay.in} to ${stay.out} at tonight’s price. It does not reserve anything.`}
          </p>
        </div>

        {alt && (
          <div className="hotels__dialog-beside">
            <p className="hotels__beside-label">
              {alt.because === 'near' ? 'Nearby, outside the block' : 'Similar money, outside the block'}
            </p>
            {/* The comparison is a way in here too, so a reader can follow it
                without closing this and hunting for the row. */}
            <button type="button" className="hotels__beside-go" onClick={() => onShow(alt.place.id)}>
              {alt.place.name}
              <span className="hotels__beside-meta">
                {alt.apart} m away
                {alt.nightly === null
                  ? ' · no price gathered'
                  : ` · ${dollars(perPerson(alt.nightly, people))} each`}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Which nights the bought prices are for — the sentence that keeps them honest.
 *
 * Gen Con's own rates are for Gen Con by definition. A market rate is for
 * whichever stay was gathered, and hotels do not open their calendars until
 * about a year out, so for most of the year the convention cannot be priced at
 * all. Measured against the live service on 2026-08-14: asking for Gen Con 2027
 * returned twenty properties and two prices, where a night six weeks out
 * returned two hundred and thirty.
 *
 * A quiet week's rate is real and useful and cheaper than the convention.
 * Printing it without saying which week would make it a convention price, which
 * it is not, and would have somebody budget short.
 *
 * Written in the plainest American English the page can manage: this is an app
 * for a convention in Indianapolis, and a reader should never have to stop and
 * work out what a word means when the word is about their money.
 */
export function stayNote(stay: Stay): string {
  if (!stay.in) return '';
  if (stay.isConvention) {
    return `Bought prices are for the convention itself, ${stay.in} to ${stay.out}. `;
  }
  return (
    `Gen Con ${stay.conventionYear} is not on sale yet — hotels open their calendars about a ` +
    `year out — so bought prices are for ${stay.in} to ${stay.out}, the same Wednesday to ` +
    `Sunday in a quiet week. Expect convention week to cost more. `
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
  /**
   * The hotels somebody has booked, lifted to `App`.
   *
   * A prop rather than a hook called here, because the budget page reads the
   * same store and two independent copies of it would disagree the moment one
   * of them was written to.
   */
  bookings: Bookings;
}

export function HotelsView({ nowMs, bookings }: Props) {
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
  /*
   * Open to begin with, because a reader who has never seen these controls
   * cannot ask for them. Once they have been used, the fold is theirs.
   */
  const [open, setOpen] = useState(true);
  const year = planningYear(nowMs);

  /*
   * The nights a new booking is made for.
   *
   * The convention's own Wednesday-to-Sunday, worked out from the first-
   * Saturday-of-August rule rather than taken from `STAY` — `STAY` is whichever
   * week the *prices* were gathered for, and for most of the year that is a
   * quiet week in October standing in for a convention that is not on sale yet.
   * Booking somebody into October because that is where the price came from
   * would be the wrong kind of honest. The dates are theirs to change on the
   * budget page.
   */
  const stay = useMemo(() => {
    const wednesday = conventionWednesday(year).toISOString().slice(0, 10);
    const days = conventionDaysOf(year);
    return { in: wednesday, out: days[days.length - 1] };
  }, [year]);

  /** How many filters are on. Sorting and sharing are not filters. */
  const onNow = [
    ring !== null,
    source !== null,
    skywalkOnly,
    withinKm < FURTHEST_KM,
    upto < DEAREST,
  ].filter(Boolean).length;

  /** The hotel whose dialog is open, if any. */
  const [showing, setShowing] = useState<string | null>(null);

  /**
   * Records a hotel as booked, or takes the record away again.
   *
   * The price is **copied**, in cents, at the moment it is pressed. `rates.ts`
   * is rewritten every month by a scheduled run, and a budget that re-priced
   * itself overnight would be one nobody could reconcile against a card
   * statement. See `bookings.ts`.
   */
  const book = useCallback(
    (row: HotelRow) => {
      if (row.nightly === null) return;
      bookings.toggle({
        placeId: row.place.id,
        name: row.place.name,
        nightlyCents: Math.round(row.nightly * 100),
        in: stay.in,
        out: stay.out,
        who: [],
        link: bookingFor(row)?.href ?? null,
        block: !!row.block,
      });
    },
    [bookings, stay],
  );

  const shownRows = useMemo(() => {
    /*
     * The surveyed hotels, and the places only the price search knows about.
     *
     * The second list is flats, condos and lofts let by the night, plus the
     * handful of real hotels OpenStreetMap missed. For a convention where four
     * people share a room those are often the cheapest way to sleep inside the
     * walk ring, and leaving them out answered "where could I stay" with only
     * half of it. They carry their own price and can never be in the block.
     */
    const surveyed = LODGING.map((place) => {
      const block = blockRate(place.id, year);
      const rate = rateFor(place.id);
      return {
        place,
        block,
        rate,
        listing: null as { link?: string | null } | null,
        source: block ? ('block' as const) : rate ? ('third' as const) : null,
        // What the page shows and sorts on: Gen Con's published figure where
        // there is one, because it beats anything bought.
        nightly: block?.low ?? rate?.nightly ?? null,
        // Gen Con is the only source for this, so a hotel outside the block
        // says nothing rather than claiming it has none.
        skywalk: hasSkywalk(place.id) === true,
      };
    });

    const listed = LISTINGS.map((one) => ({
      place: { ...one, brand: undefined, stars: undefined } as Lodging,
      block: null,
      rate: null,
      listing: one,
      source: 'third' as const,
      nightly: one.nightly,
      // Nobody surveyed a skywalk into a flat, and a listing that claims one in
      // its own name is marketing rather than a fact about the building.
      skywalk: false,
    }));

    const all = [...surveyed, ...listed];

    /*
     * Every filter but the source one. Held apart because the comparison draws
     * on it: with "Gen Con block" chosen, nothing outside the block is in view,
     * and a comparison drawn from what is in view would then be no comparison
     * at all. Everything else the reader asked for still applies to it — a
     * hotel they have filtered away is not an answer.
     */
    const kept = all
      .filter((one) => ring === null || one.place.ring === ring)
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

    const shown = kept.filter((one) => source === null || one.source === source);

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

    /*
     * The comparison, worked out in list order so "already used" means "used
     * further up the page" — which is the only order in which discouraging a
     * repeat means anything to a reader.
     */
    const candidates = kept.filter((one) => !one.block);
    const used = new Set<string>();
    const withBeside = shown.map((row) => {
      if (!row.block) return { ...row, beside: null as Beside | null };
      const found = beside(row.place, row.block.low, candidates, used);
      if (found) used.add(found.place.id);
      return { ...row, beside: found };
    });

    /*
     * Every hotel by id, filtered out or not.
     *
     * The dialog can be opened for a comparison as well as for a row, and a
     * comparison is drawn from what is in view — but the filters can change
     * under an open dialog, and a hotel that has just left the list is still
     * the hotel somebody is reading about. Looking it up in the whole set
     * rather than the shown one means the dialog never empties mid-read.
     */
    const byId = new Map(
      all.map((row) => [row.place.id, { ...row, beside: null as Beside | null }]),
    );
    for (const row of withBeside) byId.set(row.place.id, row);

    return { rows: withBeside, byId };
  }, [ring, source, skywalkOnly, withinKm, upto, sort, people, year]);

  const { rows, byId } = shownRows;

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
      {/*
        No heading and no standfirst.
        The page is reached from a menu that already says "Hotels", so a title
        repeating it is a line of the screen spent saying where you are to
        somebody who just chose to come here. The counts it carried are still on
        the page, under the list, where a number about the list belongs.
      */}

      {/*
        Sticky, and foldable, because there are seven rows of it.
        Seven rows of controls is most of a phone screen, and a reader who has
        set them is done with them and wants the hotels — but wants them back
        without scrolling to the top of two hundred rows. Folded, the bar keeps
        saying what is on, so the list is never quietly filtered by controls
        that have scrolled out of sight.
      */}
      <div className={`hotels__controls${open ? ' hotels__controls--open' : ''}`}>
        <button
          type="button"
          className="hotels__fold"
          aria-expanded={open}
          aria-controls="hotels-filters"
          onClick={() => setOpen(!open)}
        >
          <span className="hotels__fold-mark" aria-hidden="true" />
          <span className="hotels__fold-what">Filters and sorting</span>
          <span className="hotels__fold-state">
            {onNow === 0 ? 'none on' : `${onNow} on`} · by {sort}
          </span>
        </button>

        <div className="hotels__panel" id="hotels-filters" hidden={!open}>
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
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="hotels__empty">No hotel is {words}.</p>
      ) : (
        <ol className="hotels__list">
          {rows.map(({ place, rate, block, nightly, listing, beside: alt }) => {
            const booking = bookingFor({ block, rate, listing });
            return (
            <li
              key={place.id}
              className="hotels__row"
              /*
               * The whole pill opens it, which is what somebody will try — but
               * only when the press did not land on something that is already
               * a control. The price has its own bubble and the comparison
               * opens a different hotel; swallowing those would take away two
               * things the row can do to make one of them easier.
               */
              onClick={(event) => {
                // `[role="button"]` as well as `<button>`: the price bubble is
                // a span wearing the role, and a guard that only knew about the
                // tag swallowed the one press that explains the number.
                if ((event.target as HTMLElement).closest('button, a, [role="button"]')) return;
                setShowing(place.id);
              }}
            >
              <div className="hotels__what">
                <h3>
                  {/*
                    The name is the control on a phone, because "tap the hotel"
                    is what somebody will try. On a wide screen the detail is
                    already open and there is nothing for it to do, so it is not
                    a button at all rather than a button that does nothing.
                  */}
                  {/*
                    A button as well as a clickable row, because a row is not
                    reachable by keyboard and a hotel that can only be opened
                    with a pointer is a hotel half the readers cannot open.
                  */}
                  <button
                    type="button"
                    className="hotels__open"
                    onClick={() => setShowing(place.id)}
                  >
                    {place.name}
                    <span className="hotels__open-mark" aria-hidden="true" />
                  </button>
                  {/* "In the block" wrapped onto its own line behind a long
                      hotel name and read as a second heading. One word, and
                      the name breaks around it rather than it breaking. */}
                  {block && <span className="hotels__inblock">Block</span>}
                  {/* So a list of two hundred says which two you chose without
                      opening any of them. */}
                  {bookings.booked(place.id) && (
                    <span className="hotels__inblock hotels__inblock--booked">Booked</span>
                  )}
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
                    {/*
                      Three kinds of row, and only two of them have a rate
                      record. A listing found by the price search carries its
                      own figure and nothing else — no second source to
                      disagree with, no age of its own — so it says what it is
                      rather than reaching for fields that are not there.
                    */}
                    <span className="hotels__meta">
                      {block
                        ? `Gen Con’s own${block.projected ? ', projected' : ` ${BLOCK_YEAR} rate`}`
                        : rate
                          ? `${age(rate.at, nowMs)}${
                              rate.spread > 0 ? ` · they differ by ${rate.spread}` : ''
                            }`
                          : 'listed price'}
                    </span>
                    {!block && rate && (
                      <span className="hotels__meta">{rate.sources.join(', ')}</span>
                    )}
                  </>
                )}
              </div>

              {/*
                Everything the page knows about this one, in one place.

                Always in the document, never behind a condition — on a wide
                screen CSS shows it and there is nothing to press, on a phone
                CSS hides it until the name above is tapped. Rendering it only
                when open would mean a screen reader on a desktop never saw it.
              */}
              <div className="hotels__detail" id={`hotel-${place.id}`}>
                <dl>
                  <div>
                    <dt>Which nights</dt>
                    <dd>
                      {block
                        ? `Gen Con’s block rate, for the convention itself`
                        : STAY.in
                          ? STAY.isConvention
                            ? `${STAY.in} to ${STAY.out}, the convention itself`
                            : `${STAY.in} to ${STAY.out} — Gen Con ${STAY.conventionYear} is not on sale yet, so this is the same Wednesday to Sunday in a quieter week and the real thing will cost more`
                          : 'No nights gathered yet'}
                    </dd>
                  </div>
                  <div>
                    <dt>Where it is</dt>
                    <dd>
                      {place.metres < 1000
                        ? `${place.metres} m from the convention centre`
                        : `${trim(place.metres / 1000)} km from the convention centre`}
                      {place.city ? `, in ${place.city}` : ''}
                      {`. ${place.kind === 'rental' ? 'Let by the night rather than a hotel' : `A ${place.kind.replace('_', ' ')}`}`}
                      {hasSkywalk(place.id) === true
                        ? ', and on the skywalk, so the walk is indoors'
                        : '.'}
                    </dd>
                  </div>
                  <div>
                    <dt>How to book</dt>
                    <dd>
                      {booking ? (
                        <a href={booking.href} target="_blank" rel="noreferrer noopener">
                          {booking.label} ↗
                        </a>
                      ) : (
                        // Said plainly rather than papered over with a search
                        // URL dressed up as a booking.
                        'No booking link gathered for this one.'
                      )}
                    </dd>
                  </div>
                </dl>
              </div>

              {/*
                The comparison, on the row it is about.
                It used to be a section of its own under the whole list, which
                put the answer a screen and a half from the question. Not every
                block hotel gets one: with nothing near it and nothing at its
                money, there is no comparison to draw and saying so is better
                than reaching for a hotel a mile away at twice the price.
              */}
              {alt && (
                <button
                  type="button"
                  className="hotels__beside"
                  onClick={() => setShowing(alt.place.id)}
                >
                  <span className="hotels__beside-label">
                    {alt.because === 'near' ? 'Nearby, outside the block' : 'Similar money, outside the block'}
                  </span>
                  <span className="hotels__beside-name">{alt.place.name}</span>
                  <span className="hotels__beside-meta">
                    {alt.apart} m away
                    {alt.nightly === null
                      ? ' · no price gathered'
                      : ` · ${dollars(perPerson(alt.nightly, people))} each`}
                    {alt.saving !== null && alt.saving !== 0
                      ? ` · ${dollars(Math.abs(perPerson(alt.saving, people)))} a night each ${
                          alt.saving > 0 ? 'cheaper' : 'more'
                        }`
                      : ''}
                  </span>
                </button>
              )}
            </li>
            );
          })}
        </ol>
      )}

      {showing && byId.get(showing) && (
        <HotelDialog
          row={byId.get(showing)!}
          people={people}
          nowMs={nowMs}
          stay={stay}
          booked={bookings.of(showing)}
          onBook={() => book(byId.get(showing)!)}
          onClose={() => setShowing(null)}
          onShow={setShowing}
        />
      )}

      <p className="hotels__note">
        {onNow > 0
          ? `${rows.length} of ${LODGING.length} hotels are ${words}, ${priced} of them priced. `
          : `${priced} of ${rows.length} priced. `}
        Tap a price to see where it came from.{' '}
        {/*
          Which nights the bought prices are for, whenever there are any.
          Gen Con's own rates are for Gen Con by definition; a market rate is
          for whichever stay was gathered, and hotels do not open their
          calendars until about a year out — so for most of the year the
          convention cannot be priced at all and this stands in for it. Saying
          which is the difference between a comparison and a claim.
        */}
        {rows.some((one) => one.source === 'third') ? stayNote(STAY) : ''}
        {LISTINGS.length > 0
          ? `${LISTINGS.length} of these are flats and rooms let by the night rather than hotels, found in the price search and not in any survey. `
          : ''}
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
        {rows.some((one) => one.block?.projected)
          ? `Block prices are Gen Con’s real ${BLOCK_YEAR} rates carried forward at the rate this block’s own prices have actually moved since 2019. `
          : ''}
        Hotels pulled {PULLED} from OpenStreetMap, which caps its answers, so this is a sample rather
        than a complete list — {LODGING.length} in all, {walkable} of them within a{' '}
        {(WALK_METRES / 1000).toFixed(1)} km walk of the hall. Bought prices last written {REFRESHED};
        they are refreshed about once a month per hotel, within the free monthly allowances of the
        services asked, and never spent on a hotel Gen Con publishes. Distances are this app’s own
        and exact; the prices are not, unless Gen Con published them.{' '}
        <a href={SOURCE} target="_blank" rel="noreferrer noopener">
          Gen Con’s hotel list ↗
        </a>
        {RATES.length === 0 ? '' : ' · © OpenStreetMap contributors.'}
      </p>

      <p className="hotels__note">
        The block’s cheapest room anywhere is <strong>{dollars(CHEAPEST.low)}</strong> at{' '}
        {CHEAPEST.blockName}, {CHEAPEST.distance} away — published by Gen Con, and so costing this
        app no API quota at all.
      </p>
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
