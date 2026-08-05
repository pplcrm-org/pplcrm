import type { PcIconNameType } from '@icons/icons.index';

import {
  ELECTORAL_HEADER_TO_FIELD,
  ELECTORAL_IMPORT_FIELDS,
  ELECTORAL_IMPORT_FIELD_LABELS,
  PERSONS_MAPPABLE_FIELDS,
  autoMapPersonsHeader,
} from '@uxcommon/components/csv-import/persons-field-mapping';

/**
 * Everything the CSV import wizard (spec §17) needs to know about one
 * importable record type. One wizard, four configs — the per-entity mapping
 * heuristics were ported verbatim from the retired in-grid import dialogs so
 * files that auto-mapped before keep auto-mapping the same way.
 */
export type ImportEntityType = 'people' | 'companies' | 'households' | 'tasks';

export interface ImportEntityConfig {
  id: ImportEntityType;
  /** Picker-card title, e.g. "People". */
  label: string;
  /** Lowercase plural for running copy, e.g. "Import 12 people". */
  noun: string;
  icon: PcIconNameType;
  /** One-line picker-card description of what a row becomes. */
  description: string;
  /** The "· separated" facts line under the page title. */
  subtitle: string;
  mappableFields: string[];
  fieldLabels: Record<string, string>;
  autoMapHeader: (header: string) => string;
  /**
   * Fields that must be mapped before the wizard lets the user continue past
   * Map columns — the backend skips (or rejects) rows without them.
   */
  requiredFields: string[];
  /** People only: the email duplicate/bad-email Review step. */
  supportsEmailReview: boolean;
  /** Batch-level "tag everything in this import" input. */
  supportsTags: boolean;
  /** People only: "add everyone to a list" input. */
  supportsList: boolean;
  /** Shown on the Review step for types deduplicated server-side. */
  reviewNote: string | null;
  /** Where "View imported …" navigates once the import completes. */
  viewRoute: string;
}

const COMPANIES_HEADER_TO_FIELD: Record<string, string> = {
  name: 'name',
  company: 'name',
  companyname: 'name',
  organization: 'name',
  organisation: 'name',
  description: 'description',
  desc: 'description',
  website: 'website',
  web: 'website',
  url: 'website',
  email: 'email',
  emailaddress: 'email',
  phone: 'phone',
  tel: 'phone',
  telephone: 'phone',
  phonenumber: 'phone',
  industry: 'industry',
  notes: 'notes',
  note: 'notes',
  comments: 'notes',
};

/**
 * Electoral columns a file may carry, and the import fields they land in — re-exported from the
 * shared people/households mapping module so both importers offer exactly the same columns under
 * exactly the same field keys.
 *
 * This is the cheapest way a workspace gets real electoral geography, and it costs nothing at all:
 * a purchased US voter file routinely already names the congressional district, both legislative
 * district numbers and the precinct on every row, so accepting those columns writes the boundary
 * rows straight out of the file with no polygon data and no paid address lookup.
 *
 * Each column becomes its OWN boundary map rather than sharing one, because a file carrying both a
 * city council "District" column and a "CD" column is naming two genuinely different boundaries.
 *
 * The field keys and the maps they create are defined on the backend in
 * `apps/backend/src/app/modules/households/electoral-areas.ts` (`IMPORTED_AREA_SETS`); the row
 * payload is validated against `electoral-import-schema.ts` in that same folder, which drops any
 * key it does not name.
 */
export { ELECTORAL_IMPORT_FIELDS, ELECTORAL_IMPORT_FIELD_LABELS };

const HOUSEHOLDS_HEADER_TO_FIELD: Record<string, string> = {
  ...ELECTORAL_HEADER_TO_FIELD,
  streetnum: 'street_num',
  streetnumber: 'street_num',
  homestreet: 'street1',
  homestreet1: 'street1',
  homestreet2: 'street2',
  homestreet3: 'street2',
  homeaddress: 'street1',
  homeaddresspobox: 'street2',
  businessstreet: 'street1',
  businessstreet1: 'street1',
  businessstreet2: 'street2',
  businessstreet3: 'street2',
  businessaddress: 'street1',
  businessaddresspobox: 'street2',
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
  homephone: 'home_phone',
  phone: 'home_phone',
  telephone: 'home_phone',
  notes: 'notes',
  note: 'notes',
  comments: 'notes',
};

const TASKS_HEADER_TO_FIELD: Record<string, string> = {
  name: 'name',
  task: 'name',
  taskname: 'name',
  title: 'name',
  subject: 'name',
  details: 'details',
  description: 'details',
  desc: 'details',
  status: 'status',
  priority: 'priority',
  due: 'due_at',
  duedate: 'due_at',
  dueat: 'due_at',
  assignedto: 'assigned_to',
  assignee: 'assigned_to',
  owner: 'assigned_to',
};

function autoMapWith(table: Record<string, string>): (header: string) => string {
  return (header: string) => {
    const key = (header || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, '');
    return table[key] || '';
  };
}

export const IMPORT_ENTITY_CONFIGS: Record<ImportEntityType, ImportEntityConfig> = {
  people: {
    id: 'people',
    label: 'People',
    noun: 'people',
    icon: 'user-group',
    description:
      'Contacts with names, emails, phones and addresses. Duplicates are matched by email. District, ward and precinct columns are accepted as they are.',
    subtitle: 'Headers in the first row · duplicates are matched by email · nothing is written until the last step',
    mappableFields: PERSONS_MAPPABLE_FIELDS,
    fieldLabels: {
      first_name: 'First name',
      last_name: 'Last name',
      middle_names: 'Middle name(s)',
      email: 'Email',
      email2: 'Secondary email',
      mobile: 'Mobile phone',
      home_phone: 'Home phone',
      street_num: 'Street number',
      street1: 'Street line 1',
      street2: 'Street line 2',
      apt: 'Apt/Unit',
      city: 'City',
      state: 'State/Province',
      zip: 'Zip/Postal code',
      country: 'Country',
      company: 'Company',
      tags: 'Tags (comma-separated)',
      notes: 'Notes',
      // Without these the column-mapping dropdown falls back to the raw field key and offers
      // "electoral_district" instead of "District / riding".
      ...ELECTORAL_IMPORT_FIELD_LABELS,
    },
    autoMapHeader: autoMapPersonsHeader,
    requiredFields: [],
    supportsEmailReview: true,
    supportsTags: true,
    supportsList: true,
    reviewNote:
      'Any district, ward or precinct columns you map are recorded against each person’s address as they are, with no lookup and no cost.',
    viewRoute: '/people',
  },
  companies: {
    id: 'companies',
    label: 'Companies',
    noun: 'companies',
    icon: 'briefcase',
    description: 'Organizations with a name, website, contact details and industry.',
    subtitle: 'Headers in the first row · rows need a company name · nothing is written until the last step',
    mappableFields: ['name', 'description', 'website', 'email', 'phone', 'industry', 'notes'],
    fieldLabels: {
      name: 'Company name',
      description: 'Description',
      website: 'Website',
      email: 'Email',
      phone: 'Phone',
      industry: 'Industry',
      notes: 'Notes',
    },
    autoMapHeader: autoMapWith(COMPANIES_HEADER_TO_FIELD),
    requiredFields: ['name'],
    supportsEmailReview: false,
    supportsTags: false,
    supportsList: false,
    reviewNote: 'Rows without a company name are skipped during the import.',
    viewRoute: '/companies',
  },
  households: {
    id: 'households',
    label: 'Households',
    noun: 'households',
    icon: 'house-modern',
    description:
      'Addresses (doors). Each unique address becomes one household, ready for geocoding. District, ward and precinct columns are accepted as they are.',
    subtitle: 'Headers in the first row · duplicates are matched by address · nothing is written until the last step',
    mappableFields: [
      'street_num',
      'apt',
      'street1',
      'street2',
      'city',
      'state',
      'zip',
      'country',
      'home_phone',
      'notes',
      ...ELECTORAL_IMPORT_FIELDS,
    ],
    fieldLabels: {
      street_num: 'Street number',
      apt: 'Apt/Unit',
      street1: 'Street line 1',
      street2: 'Street line 2',
      city: 'City',
      state: 'State/Province',
      zip: 'Zip/Postal code',
      country: 'Country',
      home_phone: 'Home phone',
      notes: 'Notes',
      ...ELECTORAL_IMPORT_FIELD_LABELS,
    },
    autoMapHeader: autoMapWith(HOUSEHOLDS_HEADER_TO_FIELD),
    requiredFields: [],
    supportsEmailReview: false,
    supportsTags: true,
    supportsList: false,
    reviewNote:
      'Rows matching an address you already have (or repeated in the file) are skipped automatically, and new addresses are queued for geocoding. Any district, ward or precinct columns you map are recorded as they are, with no lookup and no cost.',
    viewRoute: '/households',
  },
  tasks: {
    id: 'tasks',
    label: 'Tasks',
    noun: 'tasks',
    icon: 'task',
    description: 'To-dos with a name, status, priority, due date and assignee.',
    subtitle: 'Headers in the first row · rows need a task name · nothing is written until the last step',
    mappableFields: ['name', 'details', 'status', 'priority', 'due_at', 'assigned_to'],
    fieldLabels: {
      name: 'Task name',
      details: 'Details',
      status: 'Status',
      priority: 'Priority',
      // States the formats the importer reads, because a bare 05/06/2026 is genuinely ambiguous
      // and it reads day-first (see parseImportedDueDate in the tasks controller).
      due_at: 'Due date (YYYY-MM-DD or DD/MM/YYYY)',
      assigned_to: 'Assigned to (name or email)',
    },
    autoMapHeader: autoMapWith(TASKS_HEADER_TO_FIELD),
    requiredFields: ['name'],
    supportsEmailReview: false,
    supportsTags: false,
    supportsList: false,
    reviewNote: 'Rows without a task name are skipped during the import.',
    viewRoute: '/tasks',
  },
};

export const IMPORT_ENTITY_TYPES: ImportEntityType[] = ['people', 'companies', 'households', 'tasks'];

/** Narrowing guard for the wizard's `?type=` query param. */
export function isImportEntityType(value: string | null | undefined): value is ImportEntityType {
  return value === 'people' || value === 'companies' || value === 'households' || value === 'tasks';
}

/** data_imports.source (backend vocabulary) → wizard entity type. */
export const IMPORT_SOURCE_TO_ENTITY: Record<string, ImportEntityType> = {
  persons: 'people',
  companies: 'companies',
  households: 'households',
  tasks: 'tasks',
};
