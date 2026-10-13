# Policy knowledge base

Create `policy.json` from the subreddit moderator guide.

Each chunk must include:

- `id`
- `text`
- `category`
- `visibility`: `public` or `private`
- `source`

Private chunks are allowed to influence moderation decisions but must never be disclosed in user-facing responses.
