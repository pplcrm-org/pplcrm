// Every request the Zapier app makes goes to the production API origin. There is no
// per-user base URL: the workspace API key alone selects the tenant.
const BASE_URL = 'https://api.pplcrm.com/api/zapier';

// The five REST-hook event types the backend accepts (zapier-inbound.route.ts /subscribe).
const EVENT_TYPES = ['person_created', 'person_updated', 'person_deleted', 'person_tag_added', 'person_tag_removed'];

module.exports = { BASE_URL, EVENT_TYPES };
