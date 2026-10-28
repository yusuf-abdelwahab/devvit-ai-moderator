
# Policy knowledge base

The application retrieves public and private policy separately, in that order, and then gives the combined relevant excerpts to Gemini for one decision.

## Files

- `public/policy.json`: public subreddit rules.
- `private/policy.json`: optional private rules.

Each policy chunk must include `id`, `text`, `category`, `visibility`, and `source`.

Every entry in the public file must use `"visibility": "public"`.
Every entry in the private file must use `"visibility": "private"`.
The ingestion script rejects mismatches.


## Ingest

Configure `GEMINI_API_KEY`, `SUPABASE_URL`, and
`SUPABASE_SERVICE_KEY` in your local environment.

```powershell
npx tsx scripts/ingest-policy.ts public
npx tsx scripts/ingest-policy.ts private
```

The private policy is stored in Supabase after ingestion.
Keep the service-role key server-side in Devvit secret settings.

Git ignore rules protect the local source file from being
committed; they do not secure the database copy. Restrict
access to the Supabase project and its credentials.
