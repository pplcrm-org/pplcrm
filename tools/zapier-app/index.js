const { version: platformVersion } = require('zapier-platform-core');

const packageJson = require('./package.json');
const authentication = require('./authentication');
const { triggers } = require('./triggers');
const { creates } = require('./creates');
const { searches } = require('./searches');

// Attach the workspace API key to every outgoing request.
const addBearerHeader = (request, z, bundle) => {
  if (bundle.authData.api_key) {
    request.headers = request.headers || {};
    request.headers.Authorization = `Bearer ${bundle.authData.api_key}`;
  }
  return request;
};

module.exports = {
  version: packageJson.version,
  platformVersion,
  authentication,
  beforeRequest: [addBearerHeader],
  triggers,
  creates,
  searches,
};
