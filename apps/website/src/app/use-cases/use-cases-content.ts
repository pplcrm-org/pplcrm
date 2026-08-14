/**
 * Copy for the /use-cases hub and its six detail pages.
 *
 * Everything here is a factual claim about what the product does, so it is governed by the
 * `pplcrm-website-claims` registry. The load-bearing sources:
 *
 *  - the boundary catalog names EXACTLY six published maps (Canadian federal ridings from
 *    Elections Canada, Ontario and Alberta provincial maps, three US Census sets) →
 *    `libs/common/src/lib/boundaries/catalog/catalog.entries.ts`. The federal, provincial and
 *    municipal pages below each state their level's slice of that truth — the municipal page's
 *    whole story is that NO ward map ships and drawing/importing is the path.
 *  - jurisdiction vocabulary (riding / constituency / circonscription / ward / polling
 *    division) → `libs/common/src/lib/jurisdictions/`
 *  - receipting regimes and the two carve-outs (Ontario CANDIDATE campaigns are receipted by
 *    Elections Ontario; Élections Québec issues Quebec provincial receipts — pplCRM prints
 *    neither) → `libs/common/src/lib/receipt-regimes/`
 *  - turf cutting / walk sheets / companion / deliveries facts → the `/canvassing` and
 *    `/deliveries` registry rows (this file only restates what those pages claim)
 *  - offices start with Donations OFF (the riding association fundraises) →
 *    `ORG_MODE_MODULE_DEFAULTS` in `libs/common/src/lib/org-mode.ts`
 *  - campaign contexts: shared rolodex, per-campaign support/consent/mail, archive + carry-over
 *    → the campaigns module; support carries over, voting status never does
 *  - plan gating: canvassing/deliveries/companions/geocoding are Movement; the demo gates as
 *    Movement → `libs/common/src/lib/billing/plans.ts`
 *
 * If any of those change, this file changes in the same commit. Do not add a number here that
 * is not read off the code.
 */

export type UseCaseSlug =
  | 'federal-campaign'
  | 'provincial-campaign'
  | 'municipal-campaign'
  | 'constituency-office'
  | 'advocacy'
  | 'nonprofit';

export interface RelatedLink {
  readonly label: string;
  readonly path: string;
}

/** One chronological phase of the work, with the pages that carry it. */
export interface UseCaseStage {
  readonly n: string;
  readonly title: string;
  readonly body: string;
  readonly links: readonly RelatedLink[];
}

export interface UseCaseLimit {
  readonly title: string;
  readonly body: string;
}

export interface UseCase {
  readonly slug: UseCaseSlug;
  /** Hub card title and the short name cross-links use. */
  readonly name: string;
  /** Eyebrow on the detail page. */
  readonly kicker: string;
  /** One-liner on the hub card. */
  readonly hubLine: string;
  readonly h1: string;
  readonly heroSub: string;
  readonly stages: readonly UseCaseStage[];
  /** Always present. A use-case page with no stated limits is advertising, not advice. */
  readonly limits: readonly UseCaseLimit[];
  readonly related: readonly RelatedLink[];
}

const CANVASSING_LINK: RelatedLink = { label: 'Canvassing & turfs', path: '/canvassing' };
const DELIVERIES_LINK: RelatedLink = { label: 'Yard signs & deliveries', path: '/deliveries' };
const DISTRICTS_LINK: RelatedLink = { label: 'Ridings, wards & districts', path: '/districts' };
const PRICING_LINK: RelatedLink = { label: 'Pricing', path: '/pricing' };

export const USE_CASES: readonly UseCase[] = [
  {
    slug: 'federal-campaign',
    name: 'A federal riding campaign',
    kicker: 'Use case · Federal riding',
    hubLine:
      'The Elections Canada riding map is built in. Cut turfs that stop at your riding’s lines, and run signs, mail and money from one list.',
    h1: 'Run a federal riding, door by door.',
    heroSub:
      'pplCRM ships the Elections Canada federal map — all 343 ridings on the 2023 representation order — so your workspace knows your riding’s lines the day you create it.',
    stages: [
      {
        n: '1',
        title: 'Declare the riding',
        body: 'Set up the campaign by answering one question: what are you running for? Every screen after that says riding and polling division, and the published federal boundary map is one click to add — included, official, free.',
        links: [DISTRICTS_LINK],
      },
      {
        n: '2',
        title: 'Bring the voters list',
        body: 'Import the CSV you are entitled to as a candidate. Riding and poll columns are recognized on the way in, duplicates merge, and storing the whole universe costs nothing — pricing scales with the people you email, not the people you store.',
        links: [{ label: 'Switch guides', path: '/switch' }, PRICING_LINK],
      },
      {
        n: '3',
        title: 'Cut turfs and knock',
        body: 'Point the turf cutter at any list and it cuts walkable turfs that stop at the finest boundary your workspace holds — the polling division if you have uploaded one, the riding line from the built-in map otherwise. No volunteer is sent across a boundary. Crews knock from their phones with no install and no accounts, or from a printed walk sheet with a QR code back into the app.',
        links: [CANVASSING_LINK],
      },
      {
        n: '4',
        title: 'Signs on lawns',
        body: 'Every “wants a yard sign” answer at the door becomes a delivery request. The planner turns the approved pile into hour-sized driving routes, and each driver gets a one-stop-at-a-time page carrying a first name and an address — nothing else.',
        links: [DELIVERIES_LINK],
      },
      {
        n: '5',
        title: 'Mail that lands, money that reconciles',
        body: 'Newsletters go to subscribed supporters from your own verified domain, with a deliverability score gate before every send. Donations run through your own Stripe account — you stay merchant of record — and every gift is receipted by email as it arrives, with numbered official contribution receipts at year end under the federal political regime.',
        links: [PRICING_LINK],
      },
      {
        n: '6',
        title: 'After election day',
        body: 'Archive the campaign; nothing is deleted. The rolodex stays, supporter IDs can carry into the next campaign you open, and the next race starts warmer than this one did.',
        links: [],
      },
    ],
    limits: [
      {
        title: 'We do not provide the voters list',
        body: 'Elections Canada provides candidates the list of electors; pplCRM imports it. Nothing in the product sells or appends voter data.',
      },
      {
        title: 'Turf cutting needs located doors, on Movement',
        body: 'Cutting turfs needs each door placed on the map. Address lookups run on the Movement plan, spread over a daily budget — and the demo workspace unlocks all of it so you can try before paying.',
      },
      {
        title: 'We do not file your return',
        body: 'pplCRM keeps the contribution records and prints the receipts your regime allows. Preparing and filing your Elections Canada financial return is your official agent’s job, not the software’s.',
      },
    ],
    related: [CANVASSING_LINK, DELIVERIES_LINK, DISTRICTS_LINK],
  },

  {
    slug: 'provincial-campaign',
    name: 'A provincial campaign',
    kicker: 'Use case · Provincial riding',
    hubLine:
      'Ontario and Alberta maps are included; every other province arrives by import, upload or drawing. The vocabulary follows the province on its own.',
    h1: 'Run a provincial seat in the province’s own words.',
    heroSub:
      'Ontario’s 124 provincial ridings (Elections Ontario) and Alberta’s 87 constituencies (Elections Alberta) ship as published maps. Pick your province and the words follow: constituency in Alberta, circonscription in Quebec, riding in Ontario.',
    stages: [
      {
        n: '1',
        title: 'Declare the seat',
        body: 'Choose the province and the office. In Ontario or Alberta, add the published provincial map in a click. In any other province, the map arrives your way: import the district column your voters list already carries, upload a GeoJSON, or draw the areas over your own doors.',
        links: [DISTRICTS_LINK],
      },
      {
        n: '2',
        title: 'Let the product speak the province’s language',
        body: 'Nobody types the word “constituency” — choosing Alberta chooses it, right down to the plural. Quebec reads circonscription, Newfoundland reads district, and if your race uses a word we did not predict, you can override it everywhere at once.',
        links: [DISTRICTS_LINK],
      },
      {
        n: '3',
        title: 'Cut turfs that respect the lines',
        body: 'Turfs stop at the finest boundary your workspace holds — the polling division where you have it, the riding line where you do not. Crews work from phones with no accounts, or from printed walk sheets, and every knock rolls up in the field report by the areas your race is actually run on.',
        links: [CANVASSING_LINK],
      },
      {
        n: '4',
        title: 'Signs, mail and money',
        body: 'Sign requests flow from the doorstep into delivery routes. Newsletters clear a deliverability gate before sending. Gifts land through your own Stripe account and are receipted by email as they arrive, with official receipting regimes for British Columbia, Alberta and Ontario political gifts.',
        links: [DELIVERIES_LINK],
      },
      {
        n: '5',
        title: 'After election day',
        body: 'Archive the campaign and keep the rolodex. Support levels can carry into the next campaign; voting status never copies, because last election’s turnout is not this election’s.',
        links: [],
      },
    ],
    limits: [
      {
        title: 'Only Ontario and Alberta ship as published maps',
        body: 'No other province’s boundary map is included. The other eight arrive by CSV import, GeoJSON upload or hand drawing — all three are first-class paths, and the site will tell you the same thing everywhere.',
      },
      {
        title: 'Two receipting carve-outs, stated plainly',
        body: 'Ontario candidate campaigns do not issue their own tax receipts — Elections Ontario does. Quebec provincial receipts are issued by Élections Québec. In both cases pplCRM keeps the records and prints nothing it should not.',
      },
      {
        title: 'Field features are Movement features',
        body: 'Turf cutting, the companion and delivery routes are on the Movement plan, and cutting needs geocoded doors. The demo workspace unlocks everything so you can try it all before paying.',
      },
    ],
    related: [DISTRICTS_LINK, CANVASSING_LINK, DELIVERIES_LINK],
  },

  {
    slug: 'municipal-campaign',
    name: 'A municipal campaign',
    kicker: 'Use case · Council ward',
    hubLine:
      'No ward map ships — and that is the point. Draw your wards over your own doors, or import the ward column you already have, then cut turfs that stop at ward lines.',
    h1: 'Run for council without a shapefile hunt.',
    heroSub:
      'Thousands of municipalities publish no usable ward map, or publish a PDF. pplCRM does not pretend otherwise: no city’s ward map is included. Instead it gives you three honest ways to get one — and everything downstream works the same as a federal race.',
    stages: [
      {
        n: '1',
        title: 'Declare the ward',
        body: 'Choose your city and the seat. Every screen now says ward and poll — and in a Quebec municipality, district, because the product already knows the difference.',
        links: [DISTRICTS_LINK],
      },
      {
        n: '2',
        title: 'Get the ward lines, your way',
        body: 'Import the ward column your list already carries — it filters, counts and exports immediately. Upload a GeoJSON if your city’s open-data portal has one. Or draw the wards by hand over your own geocoded doors, with vertex snapping so two wards share an edge without slivers, and a count of any household left outside every area.',
        links: [DISTRICTS_LINK],
      },
      {
        n: '3',
        title: 'Cut turfs inside the ward',
        body: 'A drawn ward bounds turf cutting exactly like an official map: turfs stop at the line, walk sheets print with numbered doors, and the companion puts the same doors on volunteers’ phones with no installs and no accounts.',
        links: [CANVASSING_LINK],
      },
      {
        n: '4',
        title: 'Signs — the municipal ground game',
        body: 'Council races are won on lawns. Sign requests from the door become hour-sized delivery routes; a canvasser carrying signs can plant one at the door and the route updates itself.',
        links: [DELIVERIES_LINK],
      },
      {
        n: '5',
        title: 'Keep the neighbourhood after the count',
        body: 'Archive the campaign, keep the rolodex, and the issues people told you about at their doors are still on their records when you knock again — next season or next term.',
        links: [],
      },
    ],
    limits: [
      {
        title: 'No city’s ward map is included',
        body: 'The published catalog covers federal ridings, Ontario and Alberta provincial maps, and US congressional and state legislative districts. Municipal wards are not in it — importing, uploading or drawing is the path, and we say so everywhere rather than implying otherwise.',
      },
      {
        title: 'A drawn ward is for organizing, not compliance',
        body: 'Hand-drawn boundaries are approximate. They are exactly right for turfs, walk lists and coverage counts, and exactly wrong for anything legal — the product says so on the page where you draw.',
      },
      {
        title: 'No municipal contribution paperwork',
        body: 'Municipal contribution rules vary city by city, and pplCRM has no municipal receipting regime. Every gift still gets a plain email receipt that claims no tax treatment; the paperwork your municipality requires stays with your financial agent.',
      },
    ],
    related: [DISTRICTS_LINK, CANVASSING_LINK, DELIVERIES_LINK],
  },

  {
    slug: 'constituency-office',
    name: 'A constituency office',
    kicker: 'Use case · Constituency office',
    hubLine:
      'Casework in a shared inbox, the riding on every household, and a year-round list an election campaign can run beside without touching.',
    h1: 'The office remembers, even when staff move on.',
    heroSub:
      'A constituency office is a decade-long relationship with the same streets. pplCRM keeps every case, call and clinic on the resident’s record — and when an election comes, the campaign runs beside the office in its own context.',
    stages: [
      {
        n: '1',
        title: 'Put the inbox where the team is',
        body: 'Connect the office’s Gmail or Microsoft mailbox and mail flows both ways. Every message gets an owner and a service-level clock, and one click turns it into a task with a due date — so nobody writes to the office twice about the same pothole, and nobody’s request dies in a personal inbox.',
        links: [],
      },
      {
        n: '2',
        title: 'Know the riding, household by household',
        body: 'Add the published riding map in a click and every geocoded household shows which riding — yours or a neighbour’s — before staff reply. Smart lists answer “everyone in the riding who raised transit” in one rule.',
        links: [DISTRICTS_LINK],
      },
      {
        n: '3',
        title: 'Casework that survives turnover',
        body: 'Cases are tasks with owners, statuses and histories on the resident’s record. When a caseworker leaves, the next one starts from the record, not from a goodbye email — the activity log keeps who did what and when.',
        links: [],
      },
      {
        n: '4',
        title: 'Clinics, town halls and door visits',
        body: 'Events take registrations online; door outreach cuts the riding into walkable routes with printed sheets and the phone companion. An office does not fundraise by default — its donations module starts off, because the riding association does that job.',
        links: [CANVASSING_LINK],
      },
      {
        n: '5',
        title: 'When the writ drops',
        body: 'Open an election campaign beside the permanent office context. It gets its own supporters, consent, mail and turfs against the same shared rolodex — and admins decide who works in which. The office’s casework never leaks into the campaign’s mail.',
        links: [],
      },
    ],
    limits: [
      {
        title: 'Consent does not cross contexts',
        body: 'A resident who emailed the office about a pothole is not a campaign subscriber. Newsletter consent lives per campaign, and the campaign context starts with its own list — that is a feature, not a gap.',
      },
      {
        title: 'The inbox is a Grassroots feature',
        body: 'Mailbox sync needs the Grassroots plan or higher. The free plan still holds the people, households, cases and events.',
      },
      {
        title: 'Field features are Movement features',
        body: 'Door-knocking routes, walk sheets and the companion are Movement-plan modules. The demo workspace unlocks them all for a real trial.',
      },
    ],
    related: [DISTRICTS_LINK, CANVASSING_LINK, PRICING_LINK],
  },

  {
    slug: 'advocacy',
    name: 'An advocacy campaign',
    kicker: 'Use case · Advocacy & movements',
    hubLine:
      'Petition at the door, QR codes that turn strangers into approved volunteers, and smart lists that know which riding every supporter lives in.',
    h1: 'Turn a cause into a list, and a list into pressure.',
    heroSub:
      'Advocacy is electoral organizing without a ballot line: the same doors, the same ridings, a different ask. pplCRM gives a movement the campaign toolset — canvassing, forms, newsletters, volunteers — pointed at an issue.',
    stages: [
      {
        n: '1',
        title: 'Grow the list at the door and online',
        body: 'Publish a signup or pledge form; every response becomes a person on the list, linked — never duplicated — if they were already on it. At the door, the canvass survey records support and issues in the same tap.',
        links: [CANVASSING_LINK],
      },
      {
        n: '2',
        title: 'Let strangers volunteer on the spot',
        body: 'Print a QR join code for the rally table. Someone who is not in your CRM scans it, signs up, and lands on a turf pending one admin approval — no app install, no account, and revoking later signs them out of every phone.',
        links: [CANVASSING_LINK],
      },
      {
        n: '3',
        title: 'Aim at the ridings that decide it',
        body: 'Add the published riding maps and every geocoded supporter knows their riding. “Everyone in the minister’s riding who signed the petition” is one smart-list rule — and one newsletter audience.',
        links: [DISTRICTS_LINK],
      },
      {
        n: '4',
        title: 'Mail that respects consent',
        body: 'Newsletters go only to subscribed supporters, from your own verified domain, with a deliverability score gate before every send and an unsubscribe link that always works. Automations handle the welcome series while you organize.',
        links: [PRICING_LINK],
      },
      {
        n: '5',
        title: 'Deliver things, not just messages',
        body: 'Lawn signs, leaflets and hamper drives become delivery routes with a one-stop-at-a-time page for each driver. The same field machinery a campaign uses, pointed at your cause.',
        links: [DELIVERIES_LINK],
      },
    ],
    limits: [
      {
        title: 'Petition signatures are not email consent',
        body: 'Signing at the door does not subscribe anyone to your newsletter. Consent is recorded separately and enforced at send time — which protects your sender reputation as much as the law.',
      },
      {
        title: 'Field features are Movement features',
        body: 'Canvassing, the companion and delivery routes are Movement-plan modules, and turf cutting needs geocoded doors on a daily budget. The demo workspace unlocks everything first.',
      },
      {
        title: 'We do not provide contact lists',
        body: 'pplCRM ships boundary maps, not people. The list is the one you build — doors, forms, events and imports.',
      },
    ],
    related: [CANVASSING_LINK, DISTRICTS_LINK, DELIVERIES_LINK],
  },

  {
    slug: 'nonprofit',
    name: 'A non-profit',
    kicker: 'Use case · Non-profits',
    hubLine:
      'Donations through your own Stripe account, CRA receipts with gap-free numbering, volunteer shifts, and delivery routes for hampers and drives.',
    h1: 'Donors, volunteers and neighbours. One honest list.',
    heroSub:
      'The spring appeal, the fall drive and Tuesday’s hamper run are one organization. pplCRM keeps them on one list — with receipting an auditor can follow and field tools a volunteer can actually use.',
    stages: [
      {
        n: '1',
        title: 'Take gifts through your own Stripe',
        body: 'Connect your organization’s own Stripe account: you are the merchant of record and the money lands in your account, with a 1% platform fee per card gift. Card data never touches pplCRM servers.',
        links: [PRICING_LINK],
      },
      {
        n: '2',
        title: 'Receipt like an auditor is watching',
        body: 'Every gift is receipted by email the moment it arrives. Registered charities issue numbered official CRA receipts at year end — the numbering is gap-free, corrections go through cancel-and-replace, and each donor gets one document: a tax receipt where possible, a giving summary where not.',
        links: [],
      },
      {
        n: '3',
        title: 'Run volunteers like you mean it',
        body: 'Publish shifts, let volunteers claim them online, and watch hours accrue on each person’s record. Teams keep the food-bank crew and the gala committee organized without three spreadsheets.',
        links: [],
      },
      {
        n: '4',
        title: 'Put the drive on wheels',
        body: 'Hampers, meal deliveries and welcome bags become hour-sized routes with a one-stop-at-a-time page for each driver — first name and address only, undo included, and a failed stop returns to the pool by itself.',
        links: [DELIVERIES_LINK],
      },
      {
        n: '5',
        title: 'Keep the story on the record',
        body: 'A family’s giving, volunteering and event history reads as one relationship, not four rows. Households connect people at one address; duplicates merge with reasons shown; the next ask goes to the right person at a respectful moment.',
        links: [],
      },
    ],
    limits: [
      {
        title: 'Official receipts need a configured regime',
        body: 'The automatic email receipt claims no tax treatment. Numbered official receipts are a year-end run under a regime you configure — CRA charitable for registered charities. If you are not registered, donors get giving summaries instead, marked as exactly that.',
      },
      {
        title: 'Donations are a Grassroots feature',
        body: 'Online giving needs the Grassroots plan or higher, and connecting Stripe happens after your workspace goes live — the demo blocks outward-facing money on purpose.',
      },
      {
        title: 'US gifts get no tax receipt',
        body: 'pplCRM has no US receipting regime: US political contributions are not tax-deductible, and no US charitable regime is modelled today. Every gift still gets the plain email receipt.',
      },
    ],
    related: [DELIVERIES_LINK, PRICING_LINK, { label: 'Switch from another tool', path: '/switch' }],
  },
];

export function useCaseBySlug(slug: string): UseCase {
  const useCase = USE_CASES.find((u) => u.slug === slug) ?? USE_CASES.at(0);
  if (!useCase) throw new Error('USE_CASES is empty');
  return useCase;
}
