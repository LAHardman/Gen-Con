/**
 * The Block Party's pitches, placed along the street. GENERATED — do not edit.
 *
 * Run `node scripts/place-block-party.mjs` to rebuild this.
 *
 * **These positions are derived, not surveyed.** Gen Con numbers its pitches —
 * Food Truck 1 to 30 down the north side, 13 stands down the south — and
 * `exhibitors.ts` says who is in which. Nothing here has a survey of where a
 * given pitch stands, so the order is Gen Con's and the spacing is this app's,
 * laid evenly along the kerbs of the street as OpenStreetMap surveyed it:
 * 10.3 m a truck and 23.8 m a stand, 4 m in from the kerb.
 *
 * So "which end of the street is this one at" is answerable to within a few
 * metres, and "which paving slab" is not. The map says as much where it draws
 * them.
 *
 * © OpenStreetMap contributors, ODbL, for the street.
 */

export interface Pitch {
  /** Gen Con's own name for the pitch: 'Food Truck 12', 'Booth BP5'. */
  spot: string;
  /** Its number within the Block Party. */
  booth: string;
  /** Who was in it when the exhibitor list was last pulled. */
  name: string;
  /** Which kerb it stands against. */
  side: 'north' | 'south';
  lat: number;
  lng: number;
}

/** Spacing, in metres, so the page can say how rough this is. */
export const TRUCK_PITCH_METRES = 10.3;

export const PITCHES: ReadonlyArray<Pitch> = [
  { spot: "Food Truck 1", booth: "1", name: "The Garnacha Spot", side: 'north', lat: 39.761671, lng: -86.165496 },
  { spot: "Food Truck 2", booth: "2", name: "Hometown Mini Donuts", side: 'north', lat: 39.761667, lng: -86.165376 },
  { spot: "Food Truck 3", booth: "3", name: "3 Girls & a Deli", side: 'north', lat: 39.761662, lng: -86.165255 },
  { spot: "Food Truck 4", booth: "4", name: "Las Tortugas", side: 'north', lat: 39.761658, lng: -86.165134 },
  { spot: "Food Truck 5", booth: "5", name: "J & J Taste of Home", side: 'north', lat: 39.761653, lng: -86.165014 },
  { spot: "Food Truck 6", booth: "6", name: "J's Lobster Truck", side: 'north', lat: 39.761649, lng: -86.164893 },
  { spot: "Food Truck 7", booth: "7", name: "Alley Cat Street Food & Catering", side: 'north', lat: 39.761655, lng: -86.164766 },
  { spot: "Food Truck 8", booth: "8", name: "Mrs. Fe's Soulfood & Catering", side: 'north', lat: 39.761661, lng: -86.164652 },
  { spot: "Food Truck 9", booth: "9", name: "The Forking Pierogi", side: 'north', lat: 39.761658, lng: -86.164531 },
  { spot: "Food Truck 10", booth: "10", name: "Pure-trition", side: 'north', lat: 39.761655, lng: -86.16441 },
  { spot: "Food Truck 11", booth: "11", name: "RMY's Soul & Comfort Food", side: 'north', lat: 39.761652, lng: -86.164289 },
  { spot: "Food Truck 12", booth: "12", name: "Arepas", side: 'north', lat: 39.761649, lng: -86.164169 },
  { spot: "Food Truck 13", booth: "13", name: "Big City Grill & Lemonade", side: 'north', lat: 39.761646, lng: -86.164048 },
  { spot: "Food Truck 14", booth: "14", name: "Tacos with Altitude", side: 'north', lat: 39.761643, lng: -86.163927 },
  { spot: "Food Truck 15", booth: "15", name: "Cupzilla", side: 'north', lat: 39.76164, lng: -86.163806 },
  { spot: "Food Truck 16", booth: "16", name: "Que Tacos Taco Truck", side: 'north', lat: 39.761638, lng: -86.163686 },
  { spot: "Food Truck 17", booth: "17", name: "Golden Spatula", side: 'north', lat: 39.761635, lng: -86.163565 },
  { spot: "Food Truck 18", booth: "18", name: "Pastelitos las Gochitas", side: 'north', lat: 39.761633, lng: -86.163444 },
  { spot: "Food Truck 19", booth: "19", name: "Scott Diggity Dogs", side: 'north', lat: 39.76163, lng: -86.163323 },
  { spot: "Food Truck 20", booth: "20", name: "Smokey Blue", side: 'north', lat: 39.761627, lng: -86.163203 },
  { spot: "Food Truck 21", booth: "21", name: "Bearded Burger", side: 'north', lat: 39.761625, lng: -86.163082 },
  { spot: "Food Truck 22", booth: "22", name: "Mr. Dough Pizza", side: 'north', lat: 39.761622, lng: -86.162961 },
  { spot: "Food Truck 23", booth: "23", name: "The Yellow Rose BBQ", side: 'north', lat: 39.761619, lng: -86.162841 },
  { spot: "Food Truck 24", booth: "24", name: "Bay Area Bistro", side: 'north', lat: 39.761616, lng: -86.16272 },
  { spot: "Food Truck 25", booth: "25", name: "Dee-Lucious Catering", side: 'north', lat: 39.761612, lng: -86.1626 },
  { spot: "Food Truck 26", booth: "26", name: "The Grub House", side: 'north', lat: 39.761609, lng: -86.162479 },
  { spot: "Food Truck 27", booth: "27", name: "El Venezolano Food Truck", side: 'north', lat: 39.761606, lng: -86.162358 },
  { spot: "Food Truck 28", booth: "28", name: "The Naughty Lobstah", side: 'north', lat: 39.761616, lng: -86.16223 },
  { spot: "Food Truck 29", booth: "29", name: "Lumpia Queen", side: 'north', lat: 39.761628, lng: -86.162111 },
  { spot: "Food Truck 30", booth: "30", name: "Ice Cream Donuts", side: 'north', lat: 39.76164, lng: -86.161991 },
  { spot: "Booth BP1", booth: "BP1", name: "HotBox Pizza", side: 'south', lat: 39.761554, lng: -86.165414 },
  { spot: "Booth BP2", booth: "BP2", name: "Subway", side: 'south', lat: 39.761547, lng: -86.165136 },
  { spot: "Booth BP3", booth: "BP3", name: "Island Noodles", side: 'south', lat: 39.76154, lng: -86.164857 },
  { spot: "Booth BP4", booth: "BP4", name: "Wild Bill's Soda", side: 'south', lat: 39.761532, lng: -86.164579 },
  { spot: "Booth BP5", booth: "BP5", name: "Critical Hit Soda", side: 'south', lat: 39.761526, lng: -86.164301 },
  { spot: "Booth BP6", booth: "BP6", name: "The Flying Cupcake", side: 'south', lat: 39.761519, lng: -86.164023 },
  { spot: "Booth BP7", booth: "BP7", name: "Daniel's Vineyard", side: 'south', lat: 39.761512, lng: -86.163744 },
  { spot: "Booth BP8", booth: "BP8", name: "Sun King Brewery", side: 'south', lat: 39.761506, lng: -86.163466 },
  { spot: "Booth BP9", booth: "BP9", name: "Red Bull", side: 'south', lat: 39.761499, lng: -86.163188 },
  { spot: "Booth BP10", booth: "BP10", name: "Helm Coffee Roasters", side: 'south', lat: 39.761493, lng: -86.16291 },
  { spot: "Booth BP11", booth: "BP11", name: "Prime 47-Indy's Steakhouse", side: 'south', lat: 39.761486, lng: -86.162631 },
  { spot: "Booth BP12", booth: "BP12", name: "Jug's Catering", side: 'south', lat: 39.76148, lng: -86.162353 },
  { spot: "Booth BP15", booth: "BP15", name: "The Shop", side: 'south', lat: 39.761473, lng: -86.162075 },
];
