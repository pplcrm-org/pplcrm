# 🚀 pplCRM Setup Guide

This guide covers setting up your local development environment for **pplCRM** from scratch.

If you are a macOS user, you can alternately run the automated setup script:

```bash
./setup.sh
```

Otherwise, follow the step-by-step instructions below.

---

## 📋 Prerequisites

Ensure you have the following installed on your machine:

- **Node.js**: Version 18 or higher (LTS recommended)
- **npm** or **Yarn**
- **Docker Desktop**: Recommended for Postgres database and Azurite blob storage emulation.

---

## 🛠️ Step-by-Step Setup

### 1. Clone & Install Dependencies

Clone the repository and install the npm dependencies:

```bash
git clone https://github.com/pplcrm-org/pplcrm.git
cd pplcrm
npm install
```

### 2. Environment Variables

Create an environment file named `.env.development` in the root of the project. This configures the backend connection to your local database and shared auth secrets.

```env
DB_USER=postgres
DB_NAME=pplcrm
DB_PASSWORD=postgres
DB_PORT=5432
DB_HOST=localhost
DB_SSL=false
SHARED_SECRET=your-super-secret
```

Optional — SMS for companion-app verification codes (Twilio). Leave these unset in
dev: the SMS service logs a `[TWILIO DEV MOCK]` line instead of sending, and email
codes work the same way via the Postmark dev mock.

```env
# TWILIO_ACCOUNT_SID=ACxxxxxxxx
# TWILIO_AUTH_TOKEN=xxxxxxxx
# TWILIO_FROM_NUMBER=+15550006789
```

### 3. Create Background Services

Two services are needed: a PostgreSQL database and Azurite (the Azure blob-storage
emulator). You can run them with Docker (option B) or directly on the machine with no
Docker at all (option A).

#### Option A — without Docker

```bash
# PostgreSQL via Homebrew (runs as a background service)
brew install postgresql@18
brew services start postgresql@18
createdb pplcrm

# Azurite via npm — foreground process, run it in its own terminal window
npm run azurite:start

# Then, in another terminal, create the uploads container and CORS policy
npm run azurite:init
```

The `azurite:start` script includes `--skipApiVersionCheck`, which is required: the
repo's `@azure/storage-blob` library speaks a newer API version than Azurite accepts,
and without the flag every storage call fails with an `InvalidHeaderValue` error.

#### Option B — with Docker

Make sure Docker Desktop is open and running, then spin up the database and storage services:

#### Database (PostgreSQL)

```bash
docker run --name pplcrm-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=pplcrm \
  -p 5432:5432 -d postgres
```

#### Blob Storage Emulation (Azurite)

```bash
docker run --name pplcrm-azurite \
  -p 10000:10000 -p 10001:10001 -p 10002:10002 \
  -d mcr.microsoft.com/azure-storage/azurite

# Initialize the storage container structure
npm run azurite:init
```

_(The init script creates the required `uploads` container, configures CORS, and outputs a local SAS URL valid for one hour)._

### 4. Run Database Migrations

Apply the database schema and migrate your local database to the latest state:

```bash
npm run db:migrate
```

---

## 📱 The companion app (volunteers)

The volunteer companions (canvassing `/t/:token`, deliveries `/r/:token`) are a
separate small Angular app, `apps/companion`, so volunteers never download the CRM
bundle.

- **Dev:** `npx nx serve companion` → http://localhost:4300 (the CRM stays on 4200).
  It proxies `/api` to the backend on :3000, so no CORS setup is needed.
- **Production:** build both apps (`nx build frontend && nx build companion`) and
  path-route at the reverse proxy: send `/t/*` and `/r/*` to the `companion` build
  output, everything else to the CRM build. Both are static bundles; the API stays
  same-origin.
- **Access model:** companion links are personal. The volunteer verifies a one-time
  code (email via Postmark, SMS via Twilio — both dev-mocked when unconfigured) and
  a first-time volunteer needs a one-time admin approval under **Volunteer access**
  in the CRM.

## 🎉 Next Steps

Now that your first-time setup is complete, you can start developing daily!
Refer back to the main [README.md](README.md) for details on daily command usage, starting/stopping services, and running tests.
