const { BASE_URL } = require('./constants');
const { PERSON_OUTPUT_FIELDS, PERSON_SAMPLE } = require('./triggers');

// Zapier search contract: return an array; an empty array means "not found" (which lets
// the user chain "create if not found" with the upsert action).
const findPerson = {
  key: 'find_person',
  noun: 'Person',
  display: {
    label: 'Find Person',
    description: 'Finds a person by email address.',
  },
  operation: {
    perform: async (z, bundle) => {
      const response = await z.request({
        url: `${BASE_URL}/persons/search`,
        params: { email: bundle.inputData.email },
      });
      return response.data;
    },
    inputFields: [
      {
        key: 'email',
        label: 'Email',
        type: 'string',
        required: true,
        helpText: 'Case-insensitive exact match on the person’s email address.',
      },
    ],
    outputFields: PERSON_OUTPUT_FIELDS,
    sample: PERSON_SAMPLE,
  },
};

module.exports = { searches: { [findPerson.key]: findPerson } };
