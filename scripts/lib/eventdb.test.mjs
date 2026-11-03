/**
 * Reading the community mirror's hour pages.
 *
 * The fixtures are cut from real pages (2026-07-30 10:00), markup unchanged.
 * What matters: ids, times (including an event that ends the next day),
 * the price and ticket numbers, and that a layout change fails loudly rather
 * than returning a short schedule.
 */

import { describe, expect, it } from 'vitest';
import { parseHourList, parseHourPage } from './eventdb.mjs';

const page = `
<div class='indentXS radius3' id='BGM'><h3>Board Game</h3></div>
<div class='indentS radius3'><strong>5 Minute Dungeon</strong></div>
<div class='indentM radius3'><strong>5 Minute Dungeon</strong></div> 
<div class='indentL topBorderless'><a href='event.php?GameCode=BGM26ND304612'><i class='icon-time'></i>Thu 10:00 am - Thu 11:00 am</a> <a href='https://www.gencon.com/events/304612' target='_blank'><i class='icon-ticket'></i>0/15</a> <i class='icon-usd'></i>2.00</div>
<div class='indentS radius3'><strong>Agricola</strong></div>
<div class='indentM radius3'><strong>Big Board Agricola</strong></div> 
<div class='indentL topBorderless'><a href='event.php?GameCode=BGM26ND308013'><i class='icon-time'></i>Thu 10:00 am - Thu 2:00 pm</a> <a href='https://www.gencon.com/events/308013' target='_blank'><i class='icon-ticket'></i>1/5</a> <i class='icon-usd'></i>8.00</div>
<ul class="nav nav-pills"><li><a href="top" class="anchor_menu"><i class="icon-level-up"></i> Top</a></li></ul>
<div class='indentXS radius3' id='CGM'><h3>Non-Collectible / TCG</h3></div>
<div class='indentS radius3'><strong>"Normal" Human</strong></div>
<div class='indentM radius3'><strong>Tom &amp; Jerry: the &quot;Long&quot; Night</strong></div> 
<div class='indentL topBorderless'><a href='event.php?GameCode=CGM26ND322636'><i class='icon-time'></i>Thu 10:00 am - Fri 12:30 am</a> <a href='https://www.gencon.com/events/322636' target='_blank'><i class='icon-ticket'></i>12/12</a> <i class='icon-usd'></i>0.00</div>
`;

describe('reading an hour page', () => {
  const events = parseHourPage(page, '2026-07-30 10:00:00');

  it('finds every session', () => {
    expect(events.map((e) => e.id)).toEqual(['BGM26ND304612', 'BGM26ND308013', 'CGM26ND322636']);
  });

  it('keeps the title, system and type, decoding entities', () => {
    expect(events[0]).toMatchObject({ title: '5 Minute Dungeon', gameSystem: '5 Minute Dungeon', type: 'BGM' });
    expect(events[1]).toMatchObject({ title: 'Big Board Agricola', gameSystem: 'Agricola', type: 'BGM' });
    expect(events[2]).toMatchObject({ title: 'Tom & Jerry: the "Long" Night', type: 'CGM' });
  });

  it('writes Eastern-time starts, ends and durations', () => {
    expect(events[0]).toMatchObject({
      start: '2026-07-30T10:00:00-04:00',
      end: '2026-07-30T11:00:00-04:00',
      durationMinutes: 60,
    });
    expect(events[1]).toMatchObject({ end: '2026-07-30T14:00:00-04:00', durationMinutes: 240 });
  });

  it('puts an event that runs past midnight on the next day', () => {
    expect(events[2].end).toBe('2026-07-31T00:30:00-04:00');
    expect(events[2].durationMinutes).toBe(870);
  });

  it('reads cost and tickets left, and says no location rather than inventing one', () => {
    expect(events[0]).toMatchObject({ cost: 2, ticketsAvailable: 0, locationText: '' });
    expect(events[2]).toMatchObject({ cost: 0, ticketsAvailable: 12 });
  });

  it('finds nothing in a page whose layout it does not recognise', () => {
    expect(parseHourPage('<html><body>Maintenance</body></html>', '2026-07-30 10:00:00')).toEqual([]);
  });
});

describe('reading the list of hours', () => {
  const html = `
<div class='dayTimeItem'><div class='pull-right'>6</div> <a href='dayTime.php?StartDate=2026-07-29 09:00:00'>Wed 9:00 am</a></div>
<div class='dayTimeItem'><div class='pull-right'>28</div> <a href='dayTime.php?StartDate=2026-07-29 10:00:00'>Wed 10:00 am</a></div>`;

  it('gives each hour and how many sessions the site says it holds', () => {
    expect(parseHourList(html)).toEqual([
      { start: '2026-07-29 09:00:00', expected: 6 },
      { start: '2026-07-29 10:00:00', expected: 28 },
    ]);
  });
});
