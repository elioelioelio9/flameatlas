/**
 * Habitat geometries for the fire model. Everything is expressed on the solver's cell grid
 * (1-based inclusive cell ranges), so the same definitions drive the solver and the 3-D scene.
 */
export type Face = "x0" | "x1" | "y0" | "y1" | "z0" | "z1";
export type Box = [number, number, number, number, number, number]; // i0,i1,j0,j1,k0,k1 (inclusive)

export interface Vent { id: string; label: string; kind: "supply" | "return"; face: Face; a: [number, number]; b: [number, number] }
export interface Door { id: string; label: string; box: Box; openDefault: boolean }
export interface Zone { id: string; name: string; box: Box }
export interface DetectorDef { id: string; label: string; zone: string; i: number; j: number; k: number; kind: "point" | "duct"; vent?: string }
export interface Furniture { id: string; label: string; box: Box; kind: "rack" | "bench" | "bunk" | "deck" | "partition" | "bulkhead" | "locker" }

export interface Habitat {
  id: "iss" | "moon" | "mars" | "earth";
  name: string;
  short: string;
  place: string;
  dx: number; nx: number; ny: number; nz: number;
  gravity: number;
  zones: Zone[];
  solids: Furniture[];        // boxes carved into the domain (doors re-open part of them)
  doors: Door[];
  vents: Vent[];
  detectors: DetectorDef[];
  cylinder?: { axis: "y"; cx: number; cz: number; r: number }; // cells outside are solid (round hull)
  ignition: { i: number; j: number; k: number; n: [number, number, number] };
  walls: "racks" | "panels" | "shell";
  backdrop: "orbit" | "moon" | "mars" | "earth";
  note: string;
}

const ISS_NX = 92, ISS_N = 13;
const issBulk = (i: number, id: string, label: string): [Furniture, Door] => [
  { id: `bulk-${id}`, label: `${label} bulkhead`, box: [i, i, 1, ISS_N, 1, ISS_N], kind: "bulkhead" },
  { id: `hatch-${id}`, label: `${label} hatch`, box: [i, i, 4, 9, 4, 9], openDefault: true },
];
const [b1, h1] = issBulk(19, "n1", "Node 1 / Lab");
const [b2, h2] = issBulk(70, "n2", "Lab / Node 2");
const issVents: Vent[] = [
  { id: "supply", label: "Cabin air supply (Node 1 forward)", kind: "supply", face: "x0", a: [2, 12], b: [2, 12] },
  { id: "return", label: "Return grille (Node 2 aft)", kind: "return", face: "x1", a: [2, 12], b: [2, 12] },
];
const issZones: Zone[] = [
  { id: "node1", name: "Node 1 (Unity)", box: [1, 18, 1, ISS_N, 1, ISS_N] },
  { id: "lab", name: "US Lab (Destiny)", box: [20, 69, 1, ISS_N, 1, ISS_N] },
  { id: "node2", name: "Node 2 (Harmony)", box: [71, ISS_NX, 1, ISS_N, 1, ISS_N] },
];
const issDet = (): DetectorDef[] => [
  { id: "node1-c", label: "Node 1 ceiling", zone: "node1", i: 9, j: ISS_N, k: 7, kind: "point" },
  { id: "lab-c", label: "Lab ceiling", zone: "lab", i: 45, j: ISS_N, k: 7, kind: "point" },
  { id: "node2-c", label: "Node 2 ceiling", zone: "node2", i: 81, j: ISS_N, k: 7, kind: "point" },
  { id: "return", label: "Return duct", zone: "node2", i: ISS_NX, j: 7, k: 7, kind: "duct", vent: "return" },
];

export const HABITATS: Habitat[] = [
  {
    id: "iss", name: "ISS — Node 1, US Lab, Node 2", short: "ISS", place: "Low Earth orbit",
    dx: 0.16, nx: ISS_NX, ny: ISS_N, nz: ISS_N, gravity: 0,
    zones: issZones, solids: [b1, b2], doors: [h1, h2], vents: issVents, detectors: issDet(),
    ignition: { i: 45, j: 1, k: 4, n: [0, 1, 0] }, walls: "racks", backdrop: "orbit",
    note: "2.08 m square aisles lined with racks; cabin air enters in Node 1 and leaves through Node 2.",
  },
  {
    id: "moon", name: "Moon base — surface habitat", short: "Moon base", place: "Taurus-Littrow backdrop (Apollo 17)",
    dx: 0.16, nx: 62, ny: 15, nz: 20, gravity: 1.62,
    zones: [
      { id: "lab", name: "Laboratory", box: [1, 35, 1, 15, 1, 20] },
      { id: "crew", name: "Crew quarters", box: [37, 53, 1, 15, 1, 20] },
      { id: "airlock", name: "Airlock", box: [55, 62, 1, 15, 1, 20] },
    ],
    solids: [
      { id: "wall-crew", label: "Lab / crew partition", box: [36, 36, 1, 15, 1, 20], kind: "partition" },
      { id: "wall-airlock", label: "Airlock bulkhead", box: [54, 54, 1, 15, 1, 20], kind: "partition" },
      { id: "bench-port", label: "Lab bench (port)", box: [3, 30, 1, 5, 1, 4], kind: "bench" },
      { id: "bench-stbd", label: "Lab bench (starboard)", box: [6, 26, 1, 5, 17, 20], kind: "bench" },
      { id: "rack-lab", label: "Equipment rack", box: [1, 2, 1, 13, 4, 17], kind: "rack" },
      { id: "bunk-1", label: "Sleep station 1", box: [38, 44, 1, 4, 16, 20], kind: "bunk" },
      { id: "bunk-2", label: "Sleep station 2", box: [46, 52, 1, 4, 16, 20], kind: "bunk" },
      { id: "locker-crew", label: "Stowage lockers", box: [38, 52, 1, 13, 1, 3], kind: "locker" },
    ],
    doors: [
      { id: "door-crew", label: "Lab / crew door", box: [36, 36, 1, 13, 8, 13], openDefault: true },
      { id: "door-airlock", label: "Airlock hatch", box: [54, 54, 1, 12, 8, 13], openDefault: false },
    ],
    vents: [
      { id: "supply-lab", label: "Ceiling diffuser (lab)", kind: "supply", face: "y1", a: [8, 14], b: [8, 13] },
      { id: "supply-crew", label: "Ceiling diffuser (crew)", kind: "supply", face: "y1", a: [42, 47], b: [8, 13] },
      { id: "return", label: "Return grille (lab, low)", kind: "return", face: "x0", a: [2, 5], b: [17, 20] },
    ],
    detectors: [
      { id: "lab-c", label: "Lab ceiling", zone: "lab", i: 22, j: 15, k: 10, kind: "point" },
      { id: "crew-c", label: "Crew ceiling", zone: "crew", i: 45, j: 15, k: 6, kind: "point" },
      { id: "airlock-c", label: "Airlock ceiling", zone: "airlock", i: 58, j: 15, k: 10, kind: "point" },
      { id: "return", label: "Return duct", zone: "lab", i: 1, j: 3, k: 18, kind: "duct", vent: "return" },
    ],
    ignition: { i: 48, j: 5, k: 18, n: [0, 1, 0] }, walls: "panels", backdrop: "moon",
    note: "A rigid surface module, 10 m × 3.2 m, 2.4 m headroom: lab, crew quarters and airlock. 1/6 g buoyancy.",
  },
  {
    id: "mars", name: "Mars habitat — two decks", short: "Mars habitat", place: "Gale crater backdrop (Curiosity)",
    dx: 0.2, nx: 30, ny: 24, nz: 30, gravity: 3.71,
    cylinder: { axis: "y", cx: 15.5, cz: 15.5, r: 14.6 },
    zones: [
      { id: "lower", name: "Lower deck (lab, EVA prep)", box: [1, 30, 1, 11, 1, 30] },
      { id: "upper", name: "Upper deck (crew quarters)", box: [1, 30, 13, 24, 1, 30] },
    ],
    solids: [
      { id: "deck", label: "Intermediate deck", box: [1, 30, 12, 12, 1, 30], kind: "deck" },
      { id: "core", label: "Utility core", box: [14, 17, 1, 11, 14, 17], kind: "rack" },
      { id: "bench-l", label: "Lab bench", box: [4, 12, 1, 4, 5, 7], kind: "bench" },
      { id: "bunks", label: "Crew sleep stations", box: [5, 12, 13, 15, 21, 26], kind: "bunk" },
      { id: "galley", label: "Galley", box: [19, 25, 13, 17, 5, 8], kind: "locker" },
    ],
    doors: [{ id: "deck-hatch", label: "Deck hatch", box: [20, 23, 12, 12, 14, 17], openDefault: true }],
    vents: [
      { id: "supply", label: "Ceiling diffuser (upper deck)", kind: "supply", face: "y1", a: [12, 19], b: [12, 19] },
      { id: "return", label: "Floor return (lower deck)", kind: "return", face: "y0", a: [7, 10], b: [20, 23] },
    ],
    detectors: [
      { id: "lower-c", label: "Lower deck ceiling", zone: "lower", i: 8, j: 11, k: 15, kind: "point" },
      { id: "upper-c", label: "Upper deck ceiling", zone: "upper", i: 15, j: 24, k: 22, kind: "point" },
      { id: "return", label: "Return duct", zone: "lower", i: 8, j: 1, k: 21, kind: "duct", vent: "return" },
    ],
    ignition: { i: 8, j: 5, k: 6, n: [0, 1, 0] }, walls: "shell", backdrop: "mars",
    note: "A 6 m diameter, two-deck habitat linked by a floor hatch. At 0.38 g hot smoke climbs to the upper deck.",
  },
  {
    id: "earth", name: "Earth — ISS mockup at 1 g", short: "Earth", place: "Ground reference",
    dx: 0.16, nx: ISS_NX, ny: ISS_N, nz: ISS_N, gravity: 9.81,
    zones: issZones, solids: [b1, b2], doors: [h1, h2], vents: issVents, detectors: issDet(),
    ignition: { i: 45, j: 1, k: 4, n: [0, 1, 0] }, walls: "racks", backdrop: "earth",
    note: "The same three modules on the ground, as in NASA's Space Vehicle Mockup Facility: buoyancy at full strength.",
  },
];

export const habitatById = (id: string) => HABITATS.find((h) => h.id === id) ?? HABITATS[0];
