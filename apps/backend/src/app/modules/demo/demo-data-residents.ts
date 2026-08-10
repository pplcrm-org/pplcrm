import type { KnockResponse, SupportLevel, VotingStatus } from '../../../../../../libs/common/src';
import type { DemoKnockDef, DemoPersonDef } from './demo-data-types';
import type { DemoStreetKey } from './demo-data-places';
import { DEMO_HOUSES, housesOn } from './demo-data-places';

/**
 * The generated residents of the demo neighbourhood, and the generated door-knocks over them.
 *
 * The 25 story households are hand-written (`demo-seed-data.ts`); the OTHER ~220 houses on the
 * fourteen demo streets need people too, or canvassing shows fourteen streets of empty doors.
 * Hand-writing hundreds of residents is not maintainable, so they are generated — but
 * DETERMINISTICALLY: every value is derived from a hash of the house key, never from
 * `Math.random()` or the clock, so every signup, every test run and both country packs see the
 * exact same neighbourhood. The output is plain `DemoPersonDef` / `DemoKnockDef` data; the seeder
 * cannot tell a generated resident from a hand-written one.
 *
 * Ground rules (the same ones the hand-written data obeys):
 * - Emails are on RFC 2606 reserved domains, so nothing a user does with the demo data can reach a
 *   real inbox. Locals carry a house-derived suffix, so no generated address can collide with the
 *   hand-written ones.
 * - Phone numbers use the fictional 555 exchange, written with the Canadian pack's area code —
 *   the seeder rewrites the area code per pack.
 * - Surnames deliberately avoid every hand-written story surname: the duplicates sweep groups on
 *   (name, address) and (name, household), and a generated "Sophie Tremblay" would put a stranger
 *   in the March-import duplicates story.
 * - Tags reference only starter vocabulary that BOTH electoral modes seed (shared tags plus
 *   'new resident'), because campaign and office mode share this rolodex.
 */

// ── Deterministic randomness ────────────────────────────────────────────────────────────────────

/** FNV-1a, the classic tiny string hash — stable across runs and platforms. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — a tiny seeded PRNG. Same seed, same sequence, everywhere. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Weighted pick: entries of [value, weight]. */
function pick<T>(rng: () => number, entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  const last = entries[entries.length - 1];
  if (!last) throw new Error('pick() needs at least one entry');
  return last[0];
}

// ── Name pools ──────────────────────────────────────────────────────────────────────────────────
// Surnames avoid every hand-written story surname (Tremblay, Sharma, O'Brien, Chen, Nguyen,
// Kowalski, MacDonald, Rahman, Lavoie, Petrov, Byrne, Wilson, Ferguson, Diallo, Haddad, Rossi,
// Singh, Kaur, El-Sayed, Okafor, Oduya, Fortin, Bergeron, Thibault, Mendes, Tanaka, Yoshida, Lam,
// Webb, Stein, Khalil, Gupta, Kelly, Reilly, Fitzgerald, Morrison, Mackenzie, Papadopoulos,
// Whitfield, Clarke, Sinclair…) so no generated resident lands in a story duplicate group.

const FIRST_NAMES = [
  'Ada',
  'Adele',
  'Adrian',
  'Aisha',
  'Alan',
  'Alice',
  'Amara',
  'Amelia',
  'Andre',
  'Angela',
  'Antoine',
  'Audrey',
  'Ben',
  'Bianca',
  'Bruno',
  'Camille',
  'Carmen',
  'Caroline',
  'Cedric',
  'Celine',
  'Claire',
  'Colin',
  'Cora',
  'Cynthia',
  'Daniel',
  'Danielle',
  'Darren',
  'Deepa',
  'Denise',
  'Derek',
  'Diego',
  'Dominic',
  'Donna',
  'Dylan',
  'Edith',
  'Eleanor',
  'Ellen',
  'Emily',
  'Erin',
  'Esther',
  'Ethan',
  'Eva',
  'Felix',
  'Fiona',
  'Gabriel',
  'Gavin',
  'Gemma',
  'Gilles',
  'Gloria',
  'Hannah',
  'Harold',
  'Hazel',
  'Helen',
  'Henry',
  'Hugo',
  'Ian',
  'Imani',
  'Ingrid',
  'Isaac',
  'Ivan',
  'Jade',
  'Jamal',
  'Janet',
  'Jared',
  'Jenna',
  'Jerome',
  'Joan',
  'Joel',
  'Jordan',
  'Josée',
  'Julia',
  'June',
  'Kamal',
  'Kara',
  'Karim',
  'Kate',
  'Keith',
  'Kendra',
  'Kira',
  'Kyle',
  'Laura',
  'Laurent',
  'Leila',
  'Lena',
  'Leo',
  'Lila',
  'Linda',
  'Logan',
  'Louise',
  'Luc',
  'Lucy',
  'Lydia',
  'Maeve',
  'Manon',
  'Marcel',
  'Margaret',
  'Maria',
  'Mario',
  'Marta',
  'Martin',
  'Mateo',
  'Maya',
  'Megan',
  'Mei',
  'Micah',
  'Miles',
  'Mina',
  'Miriam',
  'Mona',
  'Morgan',
  'Nancy',
  'Naomi',
  'Natalia',
  'Nathan',
  'Neil',
  'Nicole',
  'Nina',
  'Noah',
  'Nora',
  'Oliver',
  'Oscar',
  'Owen',
  'Paige',
  'Paolo',
  'Patricia',
  'Paul',
  'Pauline',
  'Pedro',
  'Peter',
  'Philip',
  'Phoebe',
  'Pierre',
  'Quentin',
  'Rachel',
  'Raj',
  'Renée',
  'Rhea',
  'Rita',
  'Robin',
  'Rodrigo',
  'Rosa',
  'Ruby',
  'Ruth',
  'Sabine',
  'Sally',
  'Sandra',
  'Sara',
  'Sean',
  'Selena',
  'Serge',
  'Seth',
  'Simon',
  'Sofia',
  'Stella',
  'Stuart',
  'Sylvia',
  'Tamara',
  'Tanya',
  'Tara',
  'Tessa',
  'Thomas',
  'Tina',
  'Toby',
  'Tomas',
  'Trevor',
  'Uma',
  'Valerie',
  'Vera',
  'Victor',
  'Vijay',
  'Vivian',
  'Walter',
  'Wanda',
  'Warren',
  'Wendy',
  'Willa',
  'William',
  'Xavier',
  'Yara',
  'Yasmin',
  'Yusuf',
  'Yvette',
  'Yvonne',
  'Zoe',
] as const;

const LAST_NAMES = [
  'Anand',
  'Arsenault',
  'Baker',
  'Banerjee',
  'Barlow',
  'Beaudoin',
  'Bélanger',
  'Benson',
  'Bianchi',
  'Boivin',
  'Bouchard',
  'Boyd',
  'Brar',
  'Brennan',
  'Caron',
  'Carter',
  'Castillo',
  'Chow',
  'Cormier',
  'Costa',
  'Cruz',
  'Daigle',
  'Dawson',
  'DeLuca',
  'Demers',
  'Desai',
  'Dionne',
  'Doucet',
  'Drummond',
  'Dubé',
  'Dunn',
  'Elliott',
  'Émond',
  'Farah',
  'Fleming',
  'Flores',
  'Fournier',
  'Fraser',
  'Gagnon',
  'Garcia',
  'Gauthier',
  'Gill',
  'Girard',
  'Graham',
  'Greene',
  'Hamel',
  'Hansen',
  'Harper',
  'Hassan',
  'Hébert',
  'Henderson',
  'Holt',
  'Horvath',
  'Hughes',
  'Ibrahim',
  'Iyer',
  'Jacobs',
  'Jansen',
  'Johal',
  'Kaplan',
  'Kim',
  'Klein',
  'Kovacs',
  'Kumar',
  'Lachance',
  'Landry',
  'Langlois',
  'Larsen',
  'LeBlanc',
  'Leclerc',
  'Lee',
  'Legault',
  'Lemieux',
  'Lessard',
  'Lopez',
  'Lussier',
  'Marino',
  'Martel',
  'Mason',
  'Mathieu',
  'McCann',
  'Mehta',
  'Mercier',
  'Moreau',
  'Morin',
  'Munro',
  'Nadeau',
  'Nakamura',
  'Nolan',
  'Novak',
  'Oliveira',
  'Olsen',
  'Ortiz',
  'Osman',
  'Ouellet',
  'Paquette',
  'Park',
  'Patel',
  'Pearce',
  'Pelletier',
  'Perrault',
  'Poirier',
  'Popescu',
  'Proulx',
  'Quinn',
  'Ramirez',
  'Renaud',
  'Rivard',
  'Roberge',
  'Romero',
  'Roy',
  'Ruiz',
  'Santos',
  'Sato',
  'Savard',
  'Schmidt',
  'Séguin',
  'Silva',
  'Simard',
  'Soto',
  'St-Jean',
  'Sullivan',
  'Szabo',
  'Tan',
  'Tessier',
  'Toussaint',
  'Tran',
  'Turcotte',
  'Vachon',
  'Vaillancourt',
  'Vasquez',
  'Veilleux',
  'Vega',
  'Walsh',
  'Wang',
  'Watts',
  'Weber',
  'Wong',
  'Wright',
  'Yang',
  'Yilmaz',
  'Zhang',
] as const;

/** Tags safe in BOTH electoral modes: the shared starter set plus the electoral 'new resident'. */
const RESIDENT_TAGS = [
  'senior',
  'student',
  'union member',
  'faith community',
  'community leader',
  'letter writer',
  'new resident',
  'small business owner',
] as const;

const RESIDENT_NOTES = [
  'Prefers evening door knocks — shift worker.',
  'Big dog in the yard — knock, do not open the gate.',
  'New to the street this spring.',
  'Asked for a call instead of a visit.',
  'Prefers printed material over email.',
  'Long-time resident — knows everyone on the block.',
] as const;

const SUPPORT_WEIGHTS: readonly (readonly [SupportLevel, number])[] = [
  ['strong', 24],
  ['leaning', 26],
  ['neutral', 20],
  ['undecided', 12],
  ['leaning_against', 10],
  ['against', 8],
];

const VOTING_WEIGHTS: readonly (readonly [VotingStatus, number])[] = [
  ['will_vote', 68],
  ['voted_advance', 20],
  ['not_voting', 12],
];

/** Diacritics-free, lowercase, letters-only — an email local part from a display name. */
function emailLocal(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

const EMAIL_DOMAINS = ['example.com', 'example.net', 'example.org'] as const;

// Chance rolls, named so the distribution reads as a sentence.
const VACANT_CHANCE = 0.13;
const SECOND_RESIDENT_CHANCE = 0.45; // of occupied houses; a third of those add one more
const THIRD_RESIDENT_CHANCE = 0.3;
const SHARED_SURNAME_CHANCE = 0.75;
const EMAIL_CHANCE = 0.55;
const MOBILE_CHANCE = 0.12;
const TAG_CHANCE = 0.08;
const NOTE_CHANCE = 0.05;
const SUPPORT_CHANCE = 0.45;
const VOTING_CHANCE = 0.5; // of those with a support level
const SUBSCRIBED_CHANCE = 0.4; // of those with an email
const DO_NOT_CONTACT_CHANCE = 0.02;
const CREATED_DAYS_SPREAD = 190; // staggered over ~6 months so the growth chart draws a curve
const CREATED_DAYS_MIN = 3;

interface GeneratedNeighbourhood {
  persons: readonly DemoPersonDef[];
  /** House key → person key of its first resident, for linking conversation knocks. */
  firstResidentByHouse: ReadonlyMap<string, string>;
}

function generateNeighbourhood(): GeneratedNeighbourhood {
  const persons: DemoPersonDef[] = [];
  const firstResidentByHouse = new Map<string, string>();
  const emailCounts = new Map<string, number>();
  let mobileCounter = 0;

  for (const house of DEMO_HOUSES) {
    // Story households are peopled by hand in demo-seed-data.ts.
    if (house.story) continue;
    const rng = seededRandom(hash32(`house:${house.key}`));
    if (rng() < VACANT_CHANCE) continue; // no known residents — real door lists have these

    let residents = 1;
    if (rng() < SECOND_RESIDENT_CHANCE) {
      residents = rng() < THIRD_RESIDENT_CHANCE ? 3 : 2;
    }

    const familyLast = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)] as string;
    let firstIdx = Math.floor(rng() * FIRST_NAMES.length);

    for (let r = 0; r < residents; r++) {
      const first = FIRST_NAMES[firstIdx] as string;
      // The next resident gets a different first name — same full name in one household would
      // read as (and be swept up as) a duplicate.
      firstIdx = (firstIdx + 1 + Math.floor(rng() * (FIRST_NAMES.length - 1))) % FIRST_NAMES.length;
      const last =
        r === 0 || rng() < SHARED_SURNAME_CHANCE
          ? familyLast
          : (LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)] as string);

      const key = `${house.key}-r${r + 1}`;
      let email: string | undefined;
      if (rng() < EMAIL_CHANCE) {
        const base = `${emailLocal(first)}.${emailLocal(last)}`;
        const n = (emailCounts.get(base) ?? 0) + 1;
        emailCounts.set(base, n);
        const domain = EMAIL_DOMAINS[Math.floor(rng() * EMAIL_DOMAINS.length)];
        email = `${base}${n > 1 ? String(n) : ''}@${domain}`;
      }
      const mobile = rng() < MOBILE_CHANCE ? `613-555-0${String(300 + mobileCounter++)}` : undefined;
      const supportLevel = rng() < SUPPORT_CHANCE ? pick(rng, SUPPORT_WEIGHTS) : undefined;
      const votingStatus = supportLevel && rng() < VOTING_CHANCE ? pick(rng, VOTING_WEIGHTS) : undefined;
      const doNotContact = rng() < DO_NOT_CONTACT_CHANCE;

      const person: DemoPersonDef = {
        key,
        first_name: first,
        last_name: last,
        household: house.key,
        createdDaysAgo: CREATED_DAYS_MIN + Math.floor(rng() * CREATED_DAYS_SPREAD),
        ...(email ? { email } : {}),
        ...(mobile ? { mobile } : {}),
        ...(rng() < TAG_CHANCE ? { tags: [RESIDENT_TAGS[Math.floor(rng() * RESIDENT_TAGS.length)] as string] } : {}),
        ...(rng() < NOTE_CHANCE ? { notes: RESIDENT_NOTES[Math.floor(rng() * RESIDENT_NOTES.length)] } : {}),
        ...(supportLevel ? { supportLevel } : {}),
        ...(votingStatus ? { votingStatus } : {}),
        ...(email && !doNotContact && rng() < SUBSCRIBED_CHANCE ? { subscribed: true } : {}),
        ...(doNotContact ? { doNotContact: true } : {}),
      };
      persons.push(person);
      if (r === 0) firstResidentByHouse.set(house.key, key);
    }
  }

  return { persons, firstResidentByHouse };
}

const NEIGHBOURHOOD = generateNeighbourhood();

/** The generated residents of every non-story house — appended to the electoral persons list. */
export const FILLER_PERSONS: readonly DemoPersonDef[] = NEIGHBOURHOOD.persons;

/** House key → its first generated resident, for wiring conversation knocks to a person. */
export const FILLER_FIRST_RESIDENT: ReadonlyMap<string, string> = NEIGHBOURHOOD.firstResidentByHouse;

// ── Generated knocks ────────────────────────────────────────────────────────────────────────────

const KNOCK_OUTCOME_WEIGHTS = [
  ['conversation', 42],
  ['no_answer', 30],
  ['not_home', 15],
  ['refused', 8],
  ['inaccessible', 5],
] as const satisfies readonly (readonly [DemoKnockDef['outcome'], number])[];

const KNOCK_RESPONSE_WEIGHTS: readonly (readonly [KnockResponse, number])[] = [
  ['supporter', 40],
  ['undecided', 30],
  ['non_supporter', 20],
  ['not_voting', 5],
  ['already_voted', 5],
];

export interface TurfKnockPlan {
  /** The turf's streets — every generated knock lands on one of their doors. */
  streets: readonly DemoStreetKey[];
  /** How much of the door list this pass reached: 1 = every door (a "Complete" turf). */
  coverage: number;
  /** The window the pass happened in, hours before seed time: [earliest, latest]. */
  hours: readonly [number, number];
  /** Volunteer display names, rotated across the doors. */
  canvassers: readonly string[];
  /** Doors with hand-written story knocks — skipped here so no door is knocked twice. */
  skip?: readonly string[];
}

/**
 * A canvassing pass over a turf's streets, one deterministic knock per reached door.
 *
 * `residentOf` links conversation outcomes to a real person — pass a map that covers BOTH the
 * generated residents (FILLER_FIRST_RESIDENT) and the hand-written story households, or a
 * conversation at a story door would record no one. A door whose household has no known resident
 * never rolls a conversation; it reports no_answer instead, which is also what a real canvasser
 * would log there.
 */
export function generatedKnocks(plan: TurfKnockPlan, residentOf: ReadonlyMap<string, string>): DemoKnockDef[] {
  const skip = new Set(plan.skip ?? []);
  const [earliest, latest] = plan.hours;
  const knocks: DemoKnockDef[] = [];
  let doorIndex = 0;

  for (const household of housesOn(...plan.streets)) {
    if (skip.has(household)) continue;
    const rng = seededRandom(hash32(`knock:${household}`));
    doorIndex++;
    if (plan.coverage < 1 && rng() >= plan.coverage) continue;

    const person = residentOf.get(household);
    let outcome = pick(rng, KNOCK_OUTCOME_WEIGHTS);
    if (outcome === 'conversation' && !person) outcome = 'no_answer';
    const canvasser = plan.canvassers[doorIndex % plan.canvassers.length] as string;

    knocks.push({
      household,
      outcome,
      canvasser,
      knockedHoursAgo: Math.round(earliest + rng() * (latest - earliest)),
      ...(outcome === 'conversation' && person ? { person, response: pick(rng, KNOCK_RESPONSE_WEIGHTS) } : {}),
    });
  }

  return knocks;
}
