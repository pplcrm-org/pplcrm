const { BASE_URL } = require('./constants');
const { PERSON_OUTPUT_FIELDS, PERSON_SAMPLE } = require('./triggers');

// The backend matches people by email (lowercased exact match), so email is the one
// required field on every action.
const EMAIL_FIELD = {
  key: 'email',
  label: 'Email',
  type: 'string',
  required: true,
  helpText: 'The person is matched by email address (case-insensitive, exact match).',
};

const TAG_FIELD = { key: 'tag_name', label: 'Tag', type: 'string', required: true };

const upsertPerson = {
  key: 'upsert_person',
  noun: 'Person',
  display: {
    label: 'Create or Update Person',
    description: 'Creates a person, or updates the existing person with that email.',
  },
  operation: {
    perform: async (z, bundle) => {
      const response = await z.request({
        method: 'POST',
        url: `${BASE_URL}/persons/upsert`,
        body: bundle.inputData,
      });
      return response.data;
    },
    inputFields: [
      EMAIL_FIELD,
      { key: 'first_name', label: 'First name', type: 'string' },
      { key: 'last_name', label: 'Last name', type: 'string' },
      { key: 'mobile', label: 'Mobile phone', type: 'string' },
      { key: 'home_phone', label: 'Home phone', type: 'string' },
      { key: 'notes', label: 'Notes', type: 'text' },
      { key: 'linkedin', label: 'LinkedIn', type: 'string' },
      { key: 'twitter', label: 'Twitter / X', type: 'string' },
      { key: 'facebook', label: 'Facebook', type: 'string' },
      { key: 'instagram', label: 'Instagram', type: 'string' },
    ],
    outputFields: [{ key: 'action', label: 'Action taken (created or updated)' }],
    sample: { action: 'created', person: PERSON_SAMPLE },
  },
};

const addTag = {
  key: 'add_tag',
  noun: 'Tag',
  display: {
    label: 'Add Tag to Person',
    description: 'Adds a tag to the person with that email. The tag is created if it does not exist.',
  },
  operation: {
    perform: async (z, bundle) => {
      const response = await z.request({
        method: 'POST',
        url: `${BASE_URL}/persons/tag`,
        body: bundle.inputData,
      });
      return response.data;
    },
    inputFields: [EMAIL_FIELD, TAG_FIELD],
    sample: { success: true },
  },
};

const removeTag = {
  key: 'remove_tag',
  noun: 'Tag',
  display: {
    label: 'Remove Tag from Person',
    description: 'Removes a tag from the person with that email.',
  },
  operation: {
    perform: async (z, bundle) => {
      const response = await z.request({
        method: 'POST',
        url: `${BASE_URL}/persons/untag`,
        body: bundle.inputData,
      });
      return response.data;
    },
    inputFields: [EMAIL_FIELD, TAG_FIELD],
    sample: { success: true },
  },
};

module.exports = {
  creates: {
    [upsertPerson.key]: upsertPerson,
    [addTag.key]: addTag,
    [removeTag.key]: removeTag,
  },
  PERSON_OUTPUT_FIELDS,
};
