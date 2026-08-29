const { BASE_URL } = require('./constants');

// Custom auth: the user pastes their workspace API key (Workspace settings → API keys in
// pplCRM; available on the Grassroots plan and above). The test call names the workspace,
// and the connection label shows that name next to the account in the Zap editor.
module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'api_key',
      label: 'Workspace API key',
      type: 'password',
      required: true,
      helpText:
        'Create one in pplCRM under **Workspace settings → API keys**. ' +
        'API access is included on the Grassroots plan and above.',
    },
  ],
  test: { url: `${BASE_URL}/me` },
  connectionLabel: '{{workspace}}',
};
