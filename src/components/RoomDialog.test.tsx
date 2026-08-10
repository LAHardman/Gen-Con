/**
 * The directions button in a room's title bar.
 *
 * Only the new control is covered here. The dialog's schedule, its day tabs and
 * its re-check of the source predate this and are untested; that is noted in
 * `docs/code-review.md` rather than pretended away.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoomDialog } from './RoomDialog';
import { ROOMS_BY_ID } from '../data/venues';

afterEach(cleanup);

const ROOM = ROOMS_BY_ID['hall-b'];

/** A plan that holds nothing and records what it was asked to hold. */
const emptyPlan = () => ({
  entries: [],
  planned: () => false,
  add: vi.fn(),
  remove: vi.fn(),
  toggle: vi.fn(),
});

function setup() {
  const onClose = vi.fn();
  const onZoomToRoom = vi.fn();
  const onNavigateToRoom = vi.fn();
  const plan = emptyPlan();
  render(
    <RoomDialog
      room={ROOM}
      // No events, so the dialog's re-check of the source stays idle and this
      // test needs no network at all.
      events={[]}
      feedStatus="ready"
      sourceUrl="https://gencon.eventdb.us/"
      nowMs={Date.parse('2026-08-01T14:00:00-04:00')}
      onClose={onClose}
      onZoomToRoom={onZoomToRoom}
      onNavigateToRoom={onNavigateToRoom}
      plan={plan}
    />,
  );
  return { onClose, onZoomToRoom, onNavigateToRoom, plan };
}

describe('RoomDialog', () => {
  it('offers directions from the title bar, named for the room', () => {
    setup();
    // The label carries the room, because "directions" alone tells a screen
    // reader nothing about where to.
    expect(screen.getByRole('button', { name: 'Directions to Exhibit Hall B' })).toBeTruthy();
  });

  it('starts directions to the room it is showing', () => {
    const { onNavigateToRoom, onClose, onZoomToRoom } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Directions to/ }));

    expect(onNavigateToRoom).toHaveBeenCalledWith(ROOM);
    // The app closes the dialog itself, as part of opening the panel; the
    // button must not also fire the other two ways out.
    expect(onClose).not.toHaveBeenCalled();
    expect(onZoomToRoom).not.toHaveBeenCalled();
  });

  it('leaves the other ways out where they were', () => {
    const { onClose, onZoomToRoom } = setup();
    // Two of them, deliberately: the ✕ beside the new button in the title bar,
    // and the one in the row of actions at the foot of the dialog.
    const closes = screen.getAllByRole('button', { name: 'Close' });
    expect(closes).toHaveLength(2);
    for (const button of closes) {
      onClose.mockClear();
      fireEvent.click(button);
      expect(onClose).toHaveBeenCalled();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Zoom to room' }));
    expect(onZoomToRoom).toHaveBeenCalledWith(ROOM);
  });
});
