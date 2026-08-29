const { BASE_URL } = require('./constants');

// Field list of the person object the backend sends for person_created / person_updated
// (pickPersonFields in the backend) and returns from /persons/recent and /persons/search.
const PERSON_OUTPUT_FIELDS = [
  { key: 'id', label: 'Person ID' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'email', label: 'Email' },
  { key: 'email2', label: 'Second email' },
  { key: 'mobile', label: 'Mobile phone' },
  { key: 'home_phone', label: 'Home phone' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'twitter', label: 'Twitter / X' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'notes', label: 'Notes' },
  { key: 'created_at', label: 'Created at' },
  { key: 'updated_at', label: 'Updated at' },
];

const PERSON_SAMPLE = {
  id: '42',
  first_name: 'Alex',
  last_name: 'Rivera',
  email: 'alex@example.com',
  email2: null,
  mobile: '555-0100',
  home_phone: null,
  linkedin: null,
  twitter: null,
  facebook: null,
  instagram: null,
  notes: null,
  created_at: '2026-08-01T12:00:00Z',
  updated_at: '2026-08-01T12:00:00Z',
};

const TAG_OUTPUT_FIELDS = [
  { key: 'person_id', label: 'Person ID' },
  { key: 'tag_name', label: 'Tag' },
  { key: 'tag_type', label: 'Tag type' },
];

const TAG_SAMPLE = { person_id: '42', tag_name: 'volunteer', tag_type: 'tag' };

const DELETED_OUTPUT_FIELDS = [
  { key: 'id', label: 'Person ID' },
  { key: 'email', label: 'Email' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
];

const DELETED_SAMPLE = { id: '42', email: 'alex@example.com', first_name: 'Alex', last_name: 'Rivera' };

// REST hooks: Zapier generates a hook URL per Zap, we register it with the backend and get
// back a subscription id, which Zapier stores (bundle.subscribeData) and returns on turn-off.
const performSubscribe = (eventType) => async (z, bundle) => {
  const response = await z.request({
    method: 'POST',
    url: `${BASE_URL}/subscribe`,
    body: { event_type: eventType, hook_url: bundle.targetUrl },
  });
  return response.data;
};

const performUnsubscribe = async (z, bundle) => {
  const response = await z.request({
    method: 'DELETE',
    url: `${BASE_URL}/subscribe/${bundle.subscribeData.id}`,
  });
  return response.data;
};

// The hook payload IS the trigger output — one event per delivery.
const perform = (z, bundle) => [bundle.cleanedRequest];

// Zap-editor sample data while no hook has fired yet: real recent people from the workspace.
// Tag triggers reshape them into the tag payload with a placeholder tag name — the API has
// no endpoint for recent tag events, and these rows are only editor samples.
const performList = (shape) => async (z) => {
  const response = await z.request({ url: `${BASE_URL}/persons/recent` });
  const persons = response.data;
  if (shape === 'tag') {
    return persons.map((p) => ({ person_id: p.id, tag_name: 'volunteer', tag_type: 'tag' }));
  }
  if (shape === 'deleted') {
    return persons.map((p) => ({ id: p.id, email: p.email, first_name: p.first_name, last_name: p.last_name }));
  }
  return persons;
};

const hookTrigger = ({ key, noun, label, description, shape, outputFields, sample }) => ({
  key,
  noun,
  display: { label, description },
  operation: {
    type: 'hook',
    performSubscribe: performSubscribe(key),
    performUnsubscribe,
    perform,
    performList: performList(shape),
    outputFields,
    sample,
  },
});

const triggers = {
  person_created: hookTrigger({
    key: 'person_created',
    noun: 'Person',
    label: 'New Person',
    description: 'Fires when a person is added to the workspace.',
    shape: 'person',
    outputFields: PERSON_OUTPUT_FIELDS,
    sample: PERSON_SAMPLE,
  }),
  person_updated: hookTrigger({
    key: 'person_updated',
    noun: 'Person',
    label: 'Updated Person',
    description: 'Fires when a person record is changed.',
    shape: 'person',
    outputFields: PERSON_OUTPUT_FIELDS,
    sample: PERSON_SAMPLE,
  }),
  person_deleted: hookTrigger({
    key: 'person_deleted',
    noun: 'Person',
    label: 'Deleted Person',
    description: 'Fires when a person is deleted from the workspace.',
    shape: 'deleted',
    outputFields: DELETED_OUTPUT_FIELDS,
    sample: DELETED_SAMPLE,
  }),
  person_tag_added: hookTrigger({
    key: 'person_tag_added',
    noun: 'Tag',
    label: 'Tag Added to Person',
    description: 'Fires when a tag is added to a person.',
    shape: 'tag',
    outputFields: TAG_OUTPUT_FIELDS,
    sample: TAG_SAMPLE,
  }),
  person_tag_removed: hookTrigger({
    key: 'person_tag_removed',
    noun: 'Tag',
    label: 'Tag Removed from Person',
    description: 'Fires when a tag is removed from a person.',
    shape: 'tag',
    outputFields: TAG_OUTPUT_FIELDS,
    sample: TAG_SAMPLE,
  }),
};

module.exports = { triggers, PERSON_OUTPUT_FIELDS, PERSON_SAMPLE };
