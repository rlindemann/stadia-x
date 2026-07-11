// Sample/preview data for the STADIA-X studio.
// Replace with live API results once the extraction + query backend is wired in.

export type Obligation = "shall" | "should" | "may";
export type Status = "Current" | "Superseded";

export interface Clause {
  id: string;
  pub: string;
  std: string;
  status: Status;
  path: string;
  title: string;
  ob: Obligation;
  score: number;
  quote: string; // may contain <mark> for highlighted query terms
  src: string;
  page: string;
}

export const OBLIGATION_RANK: Record<Obligation, number> = { shall: 3, should: 2, may: 1 };

export const CLAUSES: Clause[] = [
  {
    id: "gg-10-7", pub: "SGSA", std: "Guide to Safety at Sports Grounds — Green Guide, 6th ed.",
    status: "Current", path: "§10.7", title: "Gangways — dimensions", ob: "shall", score: 94.2,
    quote: "The width of a lateral <mark>gangway</mark> serving <mark>viewing</mark> accommodation shall be not less than 1.1 m, and shall be maintained clear of obstruction at all times during ingress, egress and emergency evacuation.",
    src: "Green_Guide_6ed.pdf#page=118", page: "p.104",
  },
  {
    id: "bs1-5-4-2", pub: "BSI", std: "BS EN 13200-1:2012 — Spectator facilities: layout criteria",
    status: "Current", path: "§5.4.2", title: "Circulation — radial gangways", ob: "shall", score: 90.8,
    quote: "The clear <mark>width</mark> of a radial <mark>gangway</mark> shall be a minimum of 1,2 m and shall not reduce along its length in the direction of egress.",
    src: "BS_EN_13200-1.pdf#page=27", page: "p.19",
  },
  {
    id: "uefa-18-3", pub: "UEFA", std: "UEFA Stadium Infrastructure Regulations, 2024",
    status: "Current", path: "Art. 18.3", title: "Spectator circulation routes", ob: "should", score: 82.4,
    quote: "Circulation routes and <mark>gangways</mark> should be dimensioned so that the design flow rate does not impede the safe <mark>viewing</mark> and evacuation of spectators from any sector.",
    src: "UEFA_Infrastructure_2024.pdf#page=44", page: "p.41",
  },
  {
    id: "gg-11-2", pub: "SGSA", std: "Guide to Safety at Sports Grounds — Green Guide, 6th ed.",
    status: "Current", path: "§11.2", title: "Rate of passage — barriers", ob: "shall", score: 78.9,
    quote: "The maximum rate of passage through a system of barriers serving <mark>viewing</mark> accommodation shall not exceed 660 persons per metre width per minute.",
    src: "Green_Guide_6ed.pdf#page=126", page: "p.112",
  },
  {
    id: "as-3-5", pub: "Sport England", std: "Accessible Stadia — Design Guidance",
    status: "Current", path: "§3.5", title: "Wheelchair viewing — access", ob: "should", score: 71.5,
    quote: "Access aisles to wheelchair <mark>viewing</mark> spaces should provide a clear <mark>width</mark> of at least 900 mm and should not be crossed by a stepped <mark>gangway</mark>.",
    src: "Accessible_Stadia.pdf#page=52", page: "p.48",
  },
  {
    id: "bs3-6-1", pub: "BSI", std: "BS EN 13200-3:2018 — Separating elements",
    status: "Current", path: "§6.1", title: "Handrails to gangways", ob: "may", score: 63.0,
    quote: "Where a stepped <mark>gangway</mark> exceeds two risers, a central handrail may be provided provided the resulting clear <mark>width</mark> on each side is not less than 600 mm.",
    src: "BS_EN_13200-3.pdf#page=31", page: "p.22",
  },
  {
    id: "uefa-22-1", pub: "UEFA", std: "UEFA Stadium Infrastructure Regulations, 2024",
    status: "Current", path: "Art. 22.1", title: "Sightlines — C-value", ob: "should", score: 58.6,
    quote: "Every spectator should be afforded an unobstructed line of <mark>viewing</mark> to the nearest touchline, with a recommended minimum C-value of 90 mm.",
    src: "UEFA_Infrastructure_2024.pdf#page=51", page: "p.48",
  },
  {
    id: "bs6-4-3", pub: "BSI", std: "BS EN 13200-6:2012 — Demountable stands",
    status: "Superseded", path: "§4.3", title: "Temporary gangway loading", ob: "shall", score: 52.1,
    quote: "Temporary <mark>gangways</mark> shall be designed for the same imposed crowd loading as the permanent circulation routes they replace.",
    src: "BS_EN_13200-6.pdf#page=17", page: "p.12",
  },
];

export const PUBLISHERS = ["SGSA", "UEFA", "BSI", "Sport England"] as const;

export interface Standard {
  id: string;
  code: string;
  title: string;
  publisher: string;
  version: string;
  status: Status;
  jurisdiction: string;
  clauses: number;
  updated: string;
}

export const STANDARDS: Standard[] = [
  { id: "green-guide", code: "SG:2018", title: "Guide to Safety at Sports Grounds (Green Guide)", publisher: "SGSA", version: "6th ed.", status: "Current", jurisdiction: "UK", clauses: 412, updated: "2018" },
  { id: "bs-13200-1", code: "BS EN 13200-1:2012", title: "Spectator facilities — Layout criteria for viewing area", publisher: "BSI", version: "2012", status: "Current", jurisdiction: "EU / UK", clauses: 96, updated: "2012" },
  { id: "bs-13200-3", code: "BS EN 13200-3:2018", title: "Spectator facilities — Separating elements", publisher: "BSI", version: "2018", status: "Current", jurisdiction: "EU / UK", clauses: 71, updated: "2018" },
  { id: "bs-13200-6", code: "BS EN 13200-6:2012", title: "Spectator facilities — Demountable stands", publisher: "BSI", version: "2012", status: "Superseded", jurisdiction: "EU / UK", clauses: 58, updated: "2012" },
  { id: "uefa-infra", code: "UEFA-INFRA-2024", title: "Stadium Infrastructure Regulations", publisher: "UEFA", version: "2024", status: "Current", jurisdiction: "International", clauses: 188, updated: "2024" },
  { id: "accessible-stadia", code: "AS:2004", title: "Accessible Stadia — Design Guidance", publisher: "Sport England", version: "2004", status: "Current", jurisdiction: "UK", clauses: 64, updated: "2004" },
  { id: "fifa-stadiums", code: "FIFA-STAD-2023", title: "Football Stadiums — Technical Recommendations", publisher: "UEFA", version: "6th ed.", status: "Current", jurisdiction: "International", clauses: 240, updated: "2023" },
  { id: "adg-approved-b", code: "ADB Vol.2", title: "Building Regulations Approved Document B — Fire safety", publisher: "BSI", version: "2019", status: "Current", jurisdiction: "England", clauses: 133, updated: "2022" },
];

export interface Term {
  term: string;
  definition: string;
  standard: string;
  clause: string;
}

export const TERMS: Term[] = [
  { term: "Gangway", definition: "A clear route within the viewing accommodation for the passage of spectators, either radially (up and down) or laterally (across).", standard: "Green Guide, 6th ed.", clause: "§10.1" },
  { term: "Vomitory", definition: "An access route through the seating tiers that allows spectators to reach or leave their viewing positions.", standard: "BS EN 13200-1:2012", clause: "§3.14" },
  { term: "C-value", definition: "The vertical dimension by which the sightline of a spectator clears the head of the spectator immediately in front, measured in millimetres.", standard: "UEFA Infrastructure Regulations", clause: "Art. 22.1" },
  { term: "Rate of passage", definition: "The number of persons per metre width per minute able to pass a point in a circulation system under normal or emergency conditions.", standard: "Green Guide, 6th ed.", clause: "§11.2" },
  { term: "Viewing accommodation", definition: "That part of a sports ground provided for the use of spectators to view the event, whether seated or standing.", standard: "Green Guide, 6th ed.", clause: "§2.3" },
  { term: "Wheelchair viewing space", definition: "A designated clear area within the viewing accommodation providing an unobstructed sightline for a wheelchair user and space for a companion.", standard: "Accessible Stadia", clause: "§3.2" },
  { term: "Demountable stand", definition: "A stand designed to be assembled, dismantled and re-erected, whether for temporary or repeated use.", standard: "BS EN 13200-6:2012", clause: "§3.4" },
  { term: "Final exit", definition: "The termination of an escape route from a building giving direct access to a place of safety.", standard: "Approved Document B", clause: "§B1" },
];

export const SAVED_IDS = ["gg-10-7", "uefa-22-1"];
