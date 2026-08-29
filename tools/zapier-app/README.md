# pplCRM Zapier app

The app definition Zapier runs when a user connects pplCRM in a Zap. It is **not** part of any
Nx project — nothing in the monorepo builds or deploys it. It is pushed to Zapier's platform
with the Zapier CLI, by hand, by whoever owns the Zapier developer account.

## What it contains

| Kind                | Key                  | Backed by                                            |
| ------------------- | -------------------- | ---------------------------------------------------- |
| Trigger (REST hook) | `person_created`     | `POST /api/zapier/subscribe` → webhook on person add |
| Trigger (REST hook) | `person_updated`     | same, on person change                               |
| Trigger (REST hook) | `person_deleted`     | same, on person delete                               |
| Trigger (REST hook) | `person_tag_added`   | same, on tag add                                     |
| Trigger (REST hook) | `person_tag_removed` | same, on tag remove                                  |
| Action              | `upsert_person`      | `POST /api/zapier/persons/upsert`                    |
| Action              | `add_tag`            | `POST /api/zapier/persons/tag`                       |
| Action              | `remove_tag`         | `POST /api/zapier/persons/untag`                     |
| Search              | `find_person`        | `GET /api/zapier/persons/search?email=`              |

Authentication: the user pastes a **workspace API key** (created in pplCRM under Workspace
settings → API keys; requires the Grassroots plan or above). The connection test calls
`GET /api/zapier/me`, which returns the workspace name. All endpoints are rate-limited to
120 requests per minute per workspace.

The base URL is hardcoded in `constants.js` (`https://api.pplcrm.com/api/zapier`).

## Publishing (manual, one-time setup then per-release)

```bash
cd tools/zapier-app
npm install
npm install -g zapier-platform-cli
zapier login                # the Zapier developer account that will own the app
zapier register "pplCRM"    # FIRST TIME ONLY — creates the app, writes .zapierapprc
zapier validate             # schema check, run before every push
zapier push                 # uploads this version (private to the account)
```

A pushed app is private: usable by the developer account and by anyone given an invite link
(`zapier users:add` or the share link from the developer dashboard). Making it publicly
searchable in Zapier's app directory requires `zapier promote <version>` plus Zapier's app
review process.

Two version numbers must stay compatible: `zapier-platform-core` in `package.json` and the
CLI you push with. If `zapier validate` complains about the platform version, update the
dependency to the version the CLI expects (`npm info zapier-platform-core version`) and
re-run `npm install`.

`.zapierapprc` (written by `zapier register`) holds the app id for this checkout. It is
gitignored; a new checkout re-links with `zapier link`.

## Marketing dependency

The public pricing page's plan-comparison row "API access & 300+ integrations"
(`libs/common/src/lib/billing/plans.ts`, FEATURE_MATRIX `api` row) assumes a pplCRM app
exists in Zapier's directory. Until this app is pushed and promoted, that number is only a
statement about Zapier's directory, not something a customer can use. If the app is ever
unpublished, revisit that row — see the `pplcrm-website-claims` skill.
