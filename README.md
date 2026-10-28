# AI Reddit Moderator — Devvit, Gemini, and RAG

This AI moderator is designed to assist mod teams in running high-traffic subreddits by automating mod actions backed by AI-discretion while delegating uncertain and serious decisions to human moderators.  Some moderation teams have very active members whose absence is immediately noticed if they become unavailable for a period of time.  This AI tool can help fill in that vacancy and not overwhelm other moderators with time-sensitive items.

> **Status:** Development. Verify the current Devvit APIs, configuration, schema, and moderation behavior in a test subreddit before production use. AI recommendations can be wrong and do not replace moderator judgment.

## Architecture

```text
Reddit Mod Queue / selected Modmail events
                    |
                    v
         Devvit triggers + Scheduler
                    |
                    v
      Bounded processing / idempotency
                    |
                    v
           Gemini embedding (768d)
                    |
                    v
          Supabase pgvector (RAG)
                    |
          +---------+---------+
          |                   |
          v                   v
   Retrieve PUBLIC      Retrieve PRIVATE
   policy chunks        consensus chunks
          |                   |
          +---------+---------+
                    |
                    v
        Combine relevant policy context
                    |
                    v
          Gemini moderation model
                    |
                    v
  ALLOW / REMOVE / REVIEW / BAN_PENDING
                    |
          +---------+----------+
          |                    |
          v                    v
 Optional configured       Moderator notification
 high-confidence REMOVE    for BAN_PENDING review
```

## Design goals

- Process reported posts/comments and selected Modmail events without continuously crawling every subreddit post or comment.
- Ground decisions in public subreddit rules and private moderator-consensus guidance, if applicable.
- Retrieve public policy first and private policy second, then use the combined context for one moderation analysis.
- Keep private moderator guidance out of the public Git repository.
- Prefer `REVIEW` when policy retrieval fails, context is incomplete, or moderator discretion is needed.
- AI agent can never perform a ban; If determined that ban is warranted, then loop in human moderator to review and decide.

## Technology

- **Reddit app runtime:** Reddit Devvit
- **Language / tooling:** TypeScript, Node.js, npm
- **LLM and embeddings:** Google Gemini API
- **Vector retrieval:** Supabase Postgres with `pgvector`
- **State / idempotency:** Devvit Redis
- **Local development:** Docker Desktop (optional)

## 1. Create and configure the Devvit app

For a project of this scope, Reddit's **Mod Tool Full** starter is a reasonable starting point. Create the app through the Reddit Developer portal, then use this repository as the implementation source.

Install a Node.js version compatible with the project's `package.json` and current Devvit CLI requirements. The existing project setup targets Node 24.18+.

From PowerShell in the project directory:

```powershell
npm install
npx devvit login
```

Set `devvit.json`'s `dev.subreddit` to your test subreddit, or use the Devvit CLI's supported local environment overrides. Use a dedicated test subreddit for development.

## 2. Configure Supabase

Create a Supabase project and run the SQL in:

```text
supabase/schema.sql
```

The schema should create the `policy_chunks` table with 768-dimensional embeddings and the `match_policy_chunks` similarity-search function. Review the schema and access policies before applying it to a production database.

Update the Supabase hostname in `devvit.json` to the exact hostname for your project, for example:

```text
YOUR-PROJECT.supabase.co
```

Only declare the external fetch domains the app actually needs, and verify them against current Devvit requirements.

## 3. Configure Devvit secrets

Set the app's secrets/settings through Devvit:

```powershell
npx devvit settings set gemini-api-key
npx devvit settings set supabase-url
npx devvit settings set supabase-service-key
```

Follow the prompts and current CLI behavior to enter each value. Do not hard-code credentials in source code or commit them to Git. The Supabase service-role key must remain server-side and must never be exposed to client-side code.

## 4. Keep public and private policy files separate

The policy directory should separate shareable public rules from internal moderator consensus. The intended layout is:

```text
policy/
├── public/
│   ├── subreddit_rules.json
└── private/
    ├── mod_consensus.json
```

The exact example-template filenames may differ in the current checkout; keep the real private policy file excluded from version control.

### Public policy

`policy/public/subreddit_rules.json` contains public-facing subreddit rules and any public guidance about where certain posts belong. Verify its contents against the current official rules before treating it as authoritative. A locally written summary is not necessarily a complete or verbatim copy of the official rules.

### Private moderator consensus

`policy/private/mod_consensus.json` contains internal enforcement guidance that should not be published. This file can be created if a mod team has internal consensus on moderation decisions that are not public.

### Policy record format

Each JSON file should contain an array of records. For example:

```json
[
  {
    "id": "example-policy-1",
    "text": "A concise policy statement with enough context for retrieval.",
    "category": "example-category",
    "visibility": "public",
    "source": "Public subreddit rules"
  }
]
```

Use `"visibility": "public"` for every record in the public file and `"visibility": "private"` for every record in the private file. The ingestion script should validate that each record's visibility matches the source being ingested.

### Retrieval flow

For each moderation analysis, the intended sequence is:

1. Generate an embedding for the submitted content.
2. Search Supabase for relevant chunks filtered to `public`.
3. Search Supabase again for relevant chunks filtered to `private`.
4. Combine the returned chunks while preserving source and visibility metadata.
5. Send the combined context to Gemini for one moderation analysis.
6. If retrieval fails or usable policy context is missing, prefer `REVIEW` rather than making an automatic decision from incomplete context.

The private source file is not meant to be bundled into the public repository or exposed to Reddit users. Runtime retrieval uses the ingested records in Supabase, so database credentials and access controls are important too.

## 5. Ingest policy into Supabase

For local ingestion, set credentials in your current PowerShell session. Do not commit these values:

```powershell
$env:GEMINI_API_KEY = "your-gemini-api-key"
$env:SUPABASE_URL = "https://YOUR-PROJECT.supabase.co"
$env:SUPABASE_SERVICE_KEY = "your-supabase-service-role-key"
```

With the split-policy ingestion script, ingest each source separately:

```powershell
npx tsx scripts/ingest-policy.ts public
npx tsx scripts/ingest-policy.ts private
```

These commands assume the current script accepts `public` and `private` as arguments and reads the corresponding files. If your checked-out script still accepts a file path instead, update the command to match that script before running it.

The ingestion process creates embeddings and stores policy chunks in Supabase. Keeping the source file private does not, by itself, secure private policy already stored in the database; protect the database and its service credentials accordingly.

## 6. Playtest

```powershell
npm run build
npm run dev
```

Test in the generated Devvit playtest subreddit. Verify the installed project's scripts with `package.json` if any command is unavailable.

## Moderation behavior

### Mod Queue

The app is designed to process reported posts/comments through `onPostReport` / `onCommentReport` and a scheduled, bounded queue scan. It does **not** continuously crawl all subreddit posts/comments. Confirm the event handlers and scheduler settings in the current source before deployment.

### Modmail

`onModMail` retrieves a conversation and analyzes the latest message with RAG and Gemini. It can flag a possible ban-worthy situation for moderator review. Confirm current Devvit event payloads and permissions against the installed API version.

### Human-in-the-loop

`BAN_PENDING` is a recommendation and moderator notification only. The app does not execute a ban based on an AI decision; a human moderator remains responsible for deciding whether to ban.

### Automatic removal

Automatic removal should remain disabled by default. If a moderator/developer explicitly enables `auto-remove`, only decisions meeting the configured confidence threshold should be eligible. Confidence is not a guarantee of correctness, so monitor false positives and keep human oversight.

## Fetch domains

The app may need the following declared fetch domains:

- `generativelanguage.googleapis.com` — Gemini generation and embedding calls.
- `YOUR-PROJECT.supabase.co` — Supabase vector storage and similarity search.

Replace the placeholder with your exact Supabase hostname before playtesting or submitting the app for review. Reddit requires fetch domains to be explicitly declared and may require Terms & Conditions and a Privacy Policy in the app details for apps using HTTP Fetch. Check the current Devvit submission requirements.

## Important Devvit constraints

Devvit server handlers should return quickly. AI and external database requests can approach execution time limits, so use bounded batches and scheduled processing rather than an infinite worker process.

The app is subreddit-scoped and uses Devvit-managed Reddit access. It does not require a PRAW process, a local SQLite database, a Reddit bot password, or a custom Reddit OAuth flow.

## Tests

Run the project's checks from PowerShell:

```powershell
npm test
npm run typecheck
npm run build
```

Tests should mock external API calls and cover at least:

- Public policy retrieval occurs before private policy retrieval.
- Each retrieval query applies the correct visibility filter.
- Retrieval failures produce a safe `REVIEW` result.
- Ingestion rejects records whose visibility does not match the selected source.
- Ambiguous cases and incomplete policy context do not trigger automatic actions.
- `BAN_PENDING` never invokes a ban API.
- Repeated-topic guidance is applied only when the relevant frequency/context conditions are met.

Passing unit tests does not prove that deployed behavior is correct. Test the app in a dedicated subreddit with representative false-positive and false-negative cases.

## Docker / sharing with other moderators

The repository includes a Docker container to give other developers a reproducible Node development environment.

### What Docker is for

Docker can be used to:

- Install project dependencies consistently.
- Run unit tests and TypeScript type checks.
- Build the Devvit app.
- Run local policy ingestion using developer-supplied credentials.

**Docker is not the production Reddit runtime.** Reddit's Devvit platform runs the uploaded app. Deployment remains a Devvit CLI operation, such as `devvit upload` or `devvit publish`, according to the current CLI workflow.

### Requirements

Another developer needs:

1. Docker Desktop.
2. Access to the repository or project ZIP.
3. A Devvit account with appropriate subreddit permissions if they will playtest or deploy.
4. Their own authorized Gemini and Supabase credentials if they will run ingestion.

### Build the container

```powershell
docker compose build
```

### Run tests, type checking, and build

```powershell
docker compose run --rm devvit-tools npm test
docker compose run --rm devvit-tools npm run typecheck
docker compose run --rm devvit-tools npm run build
```

The generated `dist` directory is written to the project directory if the repository is mounted into the container by the Compose configuration.

### Open a shell inside the container

The original setup uses Bash inside the container:

```powershell
docker compose run --rm devvit-tools bash
```

Then run commands such as:

```text
npm test
npm run typecheck
npm run build
```

### Local policy ingestion with Docker

Create a local `.env` file from the example:

```powershell
Copy-Item .env.example .env
```

Add the required credentials to `.env`. Verify that `.env` is ignored by Git and excluded from the Docker build context. Then run the split-policy ingestion commands:

```powershell
docker compose run --rm devvit-tools npx tsx scripts/ingest-policy.ts public
docker compose run --rm devvit-tools npx tsx scripts/ingest-policy.ts private
```

These commands assume the current ingestion script accepts visibility arguments. The credentials are supplied to the container as environment variables; they must not be baked into the image.

### Share the project

A moderator-team developer can clone the repository or extract the ZIP, open PowerShell in the project directory, and run:

```powershell
docker compose build
docker compose run --rm devvit-tools npm test
docker compose run --rm devvit-tools npm run typecheck
docker compose run --rm devvit-tools npm run build
```

Each developer should use their own Devvit login and only the credentials needed for their authorized tasks.

### Update dependencies

If `package.json` changes, rebuild the image:

```powershell
docker compose build --no-cache
```

If the existing dependency volume also needs to be recreated, be aware that `docker compose down -v` removes Compose-managed volumes:

```powershell
docker compose down -v
docker compose build
```

## Public GitHub checklist

Before making the repository public:

- [ ] Keep `policy/private/mod_consensus.json` out of Git.
- [ ] Keep `.env`, API keys, service-role keys, and credentials out of Git.
- [ ] Verify the private file is ignored:

  ```powershell
  git check-ignore -v policy/private/policy.json
  ```

- [ ] If a private file was already tracked, remove it from the index and inspect repository history before publishing. Deleting a file in a later commit does not erase earlier copies from Git history.
- [ ] If a credential was committed, treat it as exposed and rotate it.
- [ ] Keep private policy text out of public examples, screenshots, logs, and issue reports.
- [ ] Review Supabase permissions and ensure private policy data is accessible only to trusted server-side code.
- [ ] Confirm the public rules summary with the moderation team.
- [ ] Playtest before enabling automatic removal.

## Next steps

1. Confirm the public policy against the current official rules.
2. Finalize each private consensus entry with a clear action, frequency window, and exceptions.
3. Verify the ingestion script and database schema match the split-policy design.
4. Test public-first retrieval, private retrieval, and safe failure behavior.
5. Add or refine moderator review UI and audit records.
6. Run a monitored test period before considering automatic removal.

## References

- [r/MuslimMarriage official rules](https://www.reddit.com/r/MuslimMarriage/about/rules/)
- [Reddit Devvit documentation](https://developers.reddit.com/docs/)
- [Supabase documentation](https://supabase.com/docs)
- [Google Gemini API documentation](https://ai.google.dev/gemini-api/docs)
