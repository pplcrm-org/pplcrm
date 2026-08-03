/**
 * Sub-national region lists for the two countries the jurisdiction registry models.
 *
 * A "region" here is the first-level division a campaign runs inside: a Canadian province or
 * territory, or a US state. It is stored on `campaigns.office_region` as the two-letter code, and
 * it is the key that `JurisdictionSpec.regionalSeatLabels` / `regionalSubdivisionLabels` look up.
 *
 * These lists were previously private fields on the donations settings page
 * (`apps/frontend/src/app/experiences/settings/donations/donations-settings.ts`), where they drove
 * the donation-residency region picker. They are copied here verbatim — same codes, same names,
 * same order — so the office picker and the residency picker cannot drift apart. That page now
 * imports them from here.
 *
 * Deliberately NOT moved here: the country list and the German state list from that same page.
 * Donation residency accepts money from many more countries than pplCRM models elections in; this
 * module is only about where a campaign runs, and that is Canada and the United States. Keeping
 * the wider country list on the donations page keeps the two concerns from being confused.
 *
 * Codes are the ISO 3166-2 subdivision codes without the country prefix (ON, not CA-ON), which is
 * what both the donations settings and Stripe's country/state fields already use.
 */

/** One selectable region: the stored code plus the name shown to a person. */
export interface Region {
  readonly code: string;
  readonly name: string;
}

/**
 * Canada's ten provinces and three territories.
 *
 * Ordered by population rather than alphabetically, which is how the donations page listed them —
 * the four provinces that between them hold most of the country sit at the top of the picker.
 */
export const CA_PROVINCES: readonly Region[] = [
  { code: 'ON', name: 'Ontario' },
  { code: 'QC', name: 'Quebec' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'AB', name: 'Alberta' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'YT', name: 'Yukon' },
  { code: 'NU', name: 'Nunavut' },
];

/**
 * The fifty US states, alphabetical.
 *
 * The District of Columbia and the five inhabited territories are absent, matching the donations
 * page. They elect delegates rather than voting members of Congress, and the Census Bureau
 * publishes their boundaries under a different geography family, so a campaign there needs the
 * `other` jurisdiction until that is modelled properly. Adding a half-modelled DC entry here would
 * silently promise congressional-district data that does not exist.
 */
export const US_STATES: readonly Region[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

/**
 * The region list for a country code, or an empty list for a country this module does not model.
 *
 * An empty result is a real answer, not a failure: it means "we have no region list for this
 * country", and a caller should hide the region picker rather than show an empty select. Every
 * jurisdiction that returns an empty list here also has `requiresRegion: false`, so nothing can
 * become unsubmittable because of it.
 */
export function regionsForCountry(country: string | null | undefined): readonly Region[] {
  if (country === 'CA') return CA_PROVINCES;
  if (country === 'US') return US_STATES;
  return [];
}
