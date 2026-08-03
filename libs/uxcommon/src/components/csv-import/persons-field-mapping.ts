/**
 * Shared header-to-field auto-mapping heuristic for importing people from a
 * CSV/TSV file. Originally lived inline in `persons-grid.ts` (the legacy
 * modal importer); the CSV import wizard (spec §17, `/imports/new`) reuses it
 * verbatim rather than re-deriving a second mapping table.
 */

/**
 * Electoral columns a people file may carry, and the import fields they land in.
 *
 * A purchased US voter file is one row per voter, so a campaign imports it through the People
 * importer, not the Households one — and it routinely already names the congressional district,
 * both state legislative district numbers, the precinct and the ward on every row. Accepting those
 * columns writes the boundary rows straight out of the file: no polygon data, no address lookup,
 * nothing billed. It is the cheapest path there is to a working map.
 *
 * These are the same field keys the Households importer uses. The backend defines them once, in
 * `apps/backend/src/app/modules/households/electoral-areas.ts` (`IMPORTED_AREA_SETS`), and reads
 * them back out of the row payload under exactly these names.
 *
 * `apps/frontend/src/app/experiences/imports/import-entity-config.ts` imports these constants and
 * re-exports them for the Households importer, so both importers read this one list and cannot
 * drift. `electoral-import-fields.spec.ts` in that folder additionally pins that the two importers
 * map every recognised header spelling to the same field.
 */
export const ELECTORAL_IMPORT_FIELDS: string[] = [
  'electoral_district',
  'congressional_district',
  'legislative_district',
  'state_house_district',
  'state_senate_district',
  'ward',
  'precinct',
];

export const ELECTORAL_IMPORT_FIELD_LABELS: Record<string, string> = {
  electoral_district: 'District / riding',
  congressional_district: 'Congressional district',
  legislative_district: 'Legislative district',
  state_house_district: 'State house district',
  state_senate_district: 'State senate district',
  ward: 'Ward',
  precinct: 'Precinct / polling division',
};

/**
 * Header spellings people actually have, matched case-insensitively with punctuation and spacing
 * removed (`autoMapPersonsHeader` strips everything that is not a letter or a digit, so
 * "Cong. District", "CONG DISTRICT" and "cong_district" all arrive here as `congdistrict`).
 *
 * Bare "HD" and "SD" are deliberately absent. "SD" is South Dakota often enough that reading it as
 * a state house district would quietly point a whole column at the wrong boundary, and a silently
 * wrong map is worse than an unmapped column the person is asked about.
 */
export const ELECTORAL_HEADER_TO_FIELD: Record<string, string> = {
  district: 'electoral_district',
  districtname: 'electoral_district',
  electoraldistrict: 'electoral_district',
  electoraldistrictname: 'electoral_district',
  riding: 'electoral_district',
  ridingname: 'electoral_district',
  circonscription: 'electoral_district',
  councildistrict: 'electoral_district',
  cd: 'congressional_district',
  congdistrict: 'congressional_district',
  congressional: 'congressional_district',
  congressionaldistrict: 'congressional_district',
  uscongressionaldistrict: 'congressional_district',
  ld: 'legislative_district',
  legdistrict: 'legislative_district',
  legislativedistrict: 'legislative_district',
  statelegislativedistrict: 'legislative_district',
  assemblydistrict: 'state_house_district',
  housedistrict: 'state_house_district',
  statehouse: 'state_house_district',
  statehousedistrict: 'state_house_district',
  senatedistrict: 'state_senate_district',
  statesenate: 'state_senate_district',
  statesenatedistrict: 'state_senate_district',
  ward: 'ward',
  wardname: 'ward',
  wardnumber: 'ward',
  wardno: 'ward',
  precinct: 'precinct',
  precinctname: 'precinct',
  precinctnumber: 'precinct',
  poll: 'precinct',
  polldivision: 'precinct',
  pollingdivision: 'precinct',
  pollingdiv: 'precinct',
  pollingstation: 'precinct',
  pollnumber: 'precinct',
  electiondistrict: 'precinct',
  votingdistrict: 'precinct',
  vtd: 'precinct',
};

export const PERSONS_MAPPABLE_FIELDS: string[] = [
  'first_name',
  'middle_names',
  'last_name',
  'email',
  'email2',
  'mobile',
  'home_phone',
  'street_num',
  'street1',
  'street2',
  'apt',
  'city',
  'state',
  'zip',
  'country',
  'company',
  'tags',
  'notes',
  ...ELECTORAL_IMPORT_FIELDS,
];

// The electoral spellings are spread FIRST so that every entry below still wins on any key the two
// tables share. Nothing collides today; the ordering means a future addition to either table cannot
// silently change how an existing people header maps.
const HEADER_TO_FIELD: Record<string, string> = {
  ...ELECTORAL_HEADER_TO_FIELD,
  firstname: 'first_name',
  fname: 'first_name',
  givenname: 'first_name',
  middlename: 'middle_names',
  middlenames: 'middle_names',
  middleinitial: 'middle_names',
  lastname: 'last_name',
  lname: 'last_name',
  surname: 'last_name',
  familyname: 'last_name',
  name: 'first_name',
  email: 'email',
  emailaddress: 'email',
  email1: 'email',
  email1address: 'email',
  primaryemail: 'email',
  email2: 'email2',
  email2address: 'email2',
  secondaryemail: 'email2',
  mobile: 'mobile',
  mobilephone: 'mobile',
  cellphone: 'mobile',
  cell: 'mobile',
  phone: 'mobile',
  phonenumber: 'mobile',
  telephone: 'mobile',
  primaryphone: 'mobile',
  businessphone: 'mobile',
  homephone: 'home_phone',
  streetnum: 'street_num',
  streetnumber: 'street_num',
  homestreet: 'street1',
  homestreet1: 'street1',
  homestreet2: 'street2',
  homestreet3: 'street2',
  homeaddress: 'street1',
  homeaddresspobox: 'street2',
  homecity: 'city',
  homestate: 'state',
  homepostalcode: 'zip',
  homecountry: 'country',
  businessstreet: 'street1',
  businessstreet1: 'street1',
  businessstreet2: 'street2',
  businessstreet3: 'street2',
  businessaddress: 'street1',
  businessaddresspobox: 'street2',
  businesscity: 'city',
  businessstate: 'state',
  businesspostalcode: 'zip',
  businesscountry: 'country',
  address: 'street1',
  address1: 'street1',
  address2: 'street2',
  addressline1: 'street1',
  addressline2: 'street2',
  street: 'street1',
  streetaddress: 'street1',
  street1: 'street1',
  street2: 'street2',
  apt: 'apt',
  apartment: 'apt',
  unit: 'apt',
  suite: 'apt',
  city: 'city',
  town: 'city',
  state: 'state',
  province: 'state',
  stateprovince: 'state',
  region: 'state',
  zip: 'zip',
  zipcode: 'zip',
  postal: 'zip',
  postalcode: 'zip',
  postcode: 'zip',
  country: 'country',
  company: 'company',
  companyname: 'company',
  organization: 'company',
  organisation: 'company',
  employer: 'company',
  business: 'company',
  tag: 'tags',
  tags: 'tags',
  label: 'tags',
  labels: 'tags',
  groups: 'tags',
  notes: 'notes',
  note: 'notes',
  comments: 'notes',
};

/** Best-effort guess of which persons field a CSV header maps to, or '' (skip) if unknown. */
export function autoMapPersonsHeader(header: string): string {
  const raw = (header || '').toLowerCase().trim();
  const key = raw.replace(/[^a-z0-9]/g, '');
  return HEADER_TO_FIELD[key] || '';
}
