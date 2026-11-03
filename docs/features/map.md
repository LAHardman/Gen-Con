# Map

## Current state

The Map shows every convention building, room and covered skywalk, with
labels that never overlap. Tapping a building opens it and its rooms; tapping
a room opens it; tapping the ground closes whatever is open. Only the floor
being viewed is drawn. Room outlines that are estimated rather than measured
are marked. Directions draw one line per leg and clear again. While the
directions panel asks for a place, a tap supplies it. The map works from data
bundled in the app, so it does not need the server.

## User story

Dana arrives for her 10:00 game and cannot find the room. She opens the Map,
taps the hall, then the room, and asks for directions from where she stands.
The route draws across the skywalk and she follows it. A room drawn as a guess
is marked so she knows to look at signs too.

## Planned change

None. Improve room outlines only when measured data exists.

## Desired result

Anyone can find a room from the map alone, offline, and can tell guessed
geometry from traced geometry.

## How to test

| ID | Behavior | Test |
|---|---|---|
| MAP-01 | All buildings, rooms and crossings drawn; rooms hidden until opened | `src/components/MapView.test.tsx`: `what is on the map` |
| MAP-02 | Guessed rooms are marked | `MapView.test.tsx`: `telling a measured room from a placed one` |
| MAP-03 | Labels do not collide and are stable | `MapView.test.tsx`: `names that land on each other` |
| MAP-04 | One floor drawn; skywalks match the floor | `MapView.test.tsx`: `how much of a floor gets drawn`, `which skywalks belong to the floor you are on` |
| MAP-05 | Taps open/close buildings and rooms | `MapView.test.tsx`: `what a tap means` |
| MAP-06 | Directions pick points by tap and draw/clear the route | `MapView.test.tsx`: `while the directions panel is asking for a place`, `drawing the route` |
