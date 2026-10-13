# AI Reddit Moderator — Devvit + Gemini + RAG

A separate Devvit-native implementation of the AI Reddit moderator project.

## What changed from the Python version

- **TypeScript/Node + Devvit Web** instead of a standalone PRAW/Python bot.
- Reddit authentication is platform-managed; there is no Reddit client ID/secret or bot OAuth flow.
- Reddit events use Devvit triggers.
- Mod Queue work is bounded: the scheduled scanner only processes a configurable number of queue items per run.
- State/idempotency uses Devvit Redis.
- Gemini is called server-side through Devvit HTTP Fetch.
- RAG uses **Supabase Postgres + pgvector** instead of Qdrant because Devvit's current external HTTP policy lists Supabase as an approved limited-scope provider while Qdrant is not on that provider list.
- **BAN_PENDING never bans automatically.** It creates a moderator notification for human review.
- Automatic removal is disabled by default and requires both a setting and a confidence threshold.

## Architecture

```text
Reddit Mod Queue / Modmail
          |
          v
   Devvit triggers + Scheduler
          |
          v
   Deterministic/idempotency layer
          |
          v
   Gemini Embedding (768d)
          |
          v
   Supabase pgvector (RAG)
          |
          v
   Gemini moderation model
          |
          v
 ALLOW / REMOVE / REVIEW / BAN_PENDING
          |
          +--> optional high-confidence REMOVE
          |
          +--> human moderator notification for BAN_PENDING
```

## 1. Create the Devvit app

For a project this involved, Reddit recommends starting from **Mod Tool Full**. Create a Devvit app at the Reddit Developer portal, then use this repository as the source for the implementation.

Install Node 24.18+ and authenticate:

```powershell
npm install
npx devvit login
```

Set `devvit.json`'s `dev.subreddit` to your test subreddit, or use the Devvit CLI's local environment overrides.

## 2. Configure Supabase

Create a Supabase project and run:

```text
supabase/schema.sql
```

The schema creates a `policy_chunks` table with 768-dimensional vectors and a `match_policy_chunks` RPC function.

Then update the HTTP domain in `devvit.json` from:

```text
YOUR-PROJECT.supabase.co
```

to the exact hostname of your Supabase project.

## 3. Configure Devvit secrets

After uploading the app configuration, set the global secrets/settings through Devvit:

```powershell
npx devvit settings set gemini-api-key
npx devvit settings set supabase-url
npx devvit settings set supabase-service-key
```

Do not put real credentials in `.env`, source code, or Git. The Gemini and Supabase service keys are declared as secret settings.

## 4. Ingest the moderator policy

Create `policy/policy.json` using the real public rules and internal moderator-consensus chunks.

Keep private moderator policy marked as:

```json
"visibility": "private"
```

For local ingestion:

```powershell
$env:GEMINI_API_KEY="..."
$env:SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
$env:SUPABASE_SERVICE_KEY="..."
npx tsx scripts/ingest-policy.ts policy/policy.json
```

The ingestion script uses Gemini's retrieval-document embedding task. Runtime queries use retrieval-query embeddings against the same embedding model.

## 5. Playtest

```powershell
npm run build
npm run dev
```

Test in the generated Devvit playtest subreddit.

## Moderation behavior

### Mod Queue

The app handles reported posts/comments immediately through `onPostReport` / `onCommentReport`, and also has a scheduled bounded queue scan every 10 minutes. It does **not** continuously crawl all subreddit posts/comments.

### Modmail

`onModMail` retrieves the conversation, analyzes the latest message with RAG + Gemini, and can flag ban-worthy requests for human review. The app never executes a ban from an AI decision.

### Human-in-the-loop

`BAN_PENDING` creates a moderator notification containing the AI recommendation. A human moderator remains responsible for the ban.

### Automatic removal

Disabled by default. To enable it, a moderator/developer must explicitly enable `auto-remove`, and the decision must meet the configured confidence threshold.

## Fetch Domains

The app requests:

- `generativelanguage.googleapis.com` — Gemini generation and embedding API calls.
- `YOUR-PROJECT.supabase.co` — Supabase pgvector storage and similarity search.

Replace the placeholder with your exact Supabase hostname before submitting the app for review. Reddit requires HTTP fetch domains to be explicitly declared and reviewed; apps using HTTP Fetch also need Terms & Conditions and a Privacy Policy in their app details.

## Important Devvit constraints

Devvit server handlers should return quickly. Heavy AI work can approach the HTTP timeout, so the project uses bounded batches and scheduled processing rather than an infinite worker process.

The app is subreddit-scoped and uses Devvit-managed Reddit access. There is no PRAW process, local SQLite database, Reddit bot password, or custom Reddit OAuth flow.

## Tests

Pure decision/RAG helpers should be unit-tested with mocked `fetch` and Reddit APIs. The repository intentionally keeps the AI boundary behind small functions so the external APIs can be mocked.

```powershell
npm test
npm run typecheck
```

## Next implementation steps

1. Replace `policy/policy.example.json` with the actual extracted moderator guide.
2. Add a moderator review UI/menu for BAN_PENDING decisions.
3. Add explicit modmail intent handlers for flair requests, ban appeals, removal inquiries, and spam.
4. Add richer audit records in Redis.
5. Playtest against a dedicated test subreddit before enabling automatic removal.

## Docker / sharing with other moderators

The repository includes a Docker container so another developer on the mod team can get the same Node 24 development environment without installing the project toolchain directly on their machine.

### What Docker is for

Docker is used here for:

- installing the project's Node/npm dependencies consistently;
- running unit tests;
- running TypeScript type checks;
- creating the Devvit production build artifact;
- running the local policy-ingestion script with developer-supplied credentials.

**Docker is not the production Reddit runtime.** Reddit's Devvit platform runs the uploaded app. Deployment remains a Devvit CLI operation (`devvit upload` / `devvit publish`).

### Requirements for another developer

They only need:

1. Docker Desktop.
2. Access to this repository/ZIP.
3. A Devvit account with the appropriate subreddit permissions if they will playtest/deploy.
4. The required Gemini/Supabase credentials if they will run policy ingestion locally.

### Build the container

From PowerShell in the project directory:

```powershell
docker compose build
```

### Run tests

```powershell
docker compose run --rm devvit-tools npm test
```

### Run type checking

```powershell
docker compose run --rm devvit-tools npm run typecheck
```

### Run the Devvit build

```powershell
docker compose run --rm devvit-tools npm run build
```

The generated `dist` directory is written to the project directory because the repository is mounted into the container.

### Open a shell inside the container

```powershell
docker compose run --rm devvit-tools bash
```

From that shell, normal project commands can be run, for example:

```text
npm test
npm run typecheck
npm run build
```

### Local policy ingestion from Docker

Create a local `.env` file from the supplied example:

```powershell
Copy-Item .env.example .env
```

Then edit `.env` and add the Gemini and Supabase credentials. `.env` is ignored by Git and Docker's build context.

Run ingestion with:

```powershell
docker compose run --rm devvit-tools npx tsx scripts/ingest-policy.ts policy/policy.json
```

The credentials are passed into the container as environment variables. They are not baked into the Docker image.

### Sharing the project

A mod-team developer can receive either the Git repository or this ZIP, extract it, open PowerShell in the project directory, and run:

```powershell
docker compose build
docker compose run --rm devvit-tools npm test
docker compose run --rm devvit-tools npm run typecheck
docker compose run --rm devvit-tools npm run build
```

This keeps the development environment reproducible while still leaving Devvit authentication and Reddit deployment under each developer's own account.

### Updating dependencies

If `package.json` changes, rebuild the image:

```powershell
docker compose build --no-cache
```

If the existing dependency volume needs to be recreated as well:

```powershell
docker compose down -v
docker compose build
```
