
import fs from 'node:fs/promises';

type Visibility = 'public' | 'private';

interface PolicyInput {
  id: string;
  text: string;
  category: string;
  visibility: Visibility;
  source: string;
}

const visibilityArg = process.argv[2];

if (
  visibilityArg !== 'public' &&
  visibilityArg !== 'private'
) {
  throw new Error(
    'Usage: npx tsx scripts/ingest-policy.ts <public|private> [path-to-policy.json]'
  );
}

const visibility: Visibility = visibilityArg;

const defaultPath =
  visibility === 'public'
    ? 'policy/public/subreddit_rules.json'
    : 'policy/private/mod_consensus.json';

const policyPath = process.argv[3] ?? defaultPath;

const geminiKey = process.env.GEMINI_API_KEY;
const supabaseUrl =
  process.env.SUPABASE_URL?.replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!geminiKey || !supabaseUrl || !supabaseKey) {
  throw new Error(
    'Set GEMINI_API_KEY, SUPABASE_URL, and SUPABASE_SERVICE_KEY before ingesting policy.'
  );
}

const chunks = JSON.parse(
  await fs.readFile(policyPath, 'utf8')
) as PolicyInput[];

if (!Array.isArray(chunks) || chunks.length === 0) {
  throw new Error(
    `Policy file must contain a non-empty JSON array: ${policyPath}`
  );
}

// Validate the entire input before uploading anything.
const seenIds = new Set<string>();

for (const chunk of chunks) {
  if (
    !chunk.id ||
    !chunk.text ||
    !chunk.category ||
    !chunk.source
  ) {
    throw new Error(
      `Each policy chunk needs id, text, category, and source (${policyPath}).`
    );
  }

  if (chunk.visibility !== visibility) {
    throw new Error(
      `Policy chunk "${chunk.id}" is marked "${chunk.visibility}" ` +
      `but this run is ingesting "${visibility}" policy.`
    );
  }

  if (seenIds.has(chunk.id)) {
    throw new Error(
      `Duplicate policy chunk id "${chunk.id}" in ${policyPath}.`
    );
  }

  seenIds.add(chunk.id);
}

for (const chunk of chunks) {
  const embeddingResponse = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': geminiKey,
      },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: {
          parts: [{ text: chunk.text }],
        },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: 768,
      }),
    }
  );

  if (!embeddingResponse.ok) {
    throw new Error(
      `Gemini embedding failed for ${chunk.id}: ` +
      `${embeddingResponse.status} ${await embeddingResponse.text()}`
    );
  }

  const data = await embeddingResponse.json() as {
    embedding?: { values?: number[] };
  };

  const embedding = data.embedding?.values;

  if (!embedding?.length) {
    throw new Error(
      `Gemini returned an empty embedding for ${chunk.id}.`
    );
  }

  if (embedding.length !== 768) {
    throw new Error(
      `Expected 768 embedding dimensions for ${chunk.id}, got ${embedding.length}.`
    );
  } 
  // Separate the database IDs for each policy source.
  const databaseChunk = {
    id: `${visibility}:${chunk.id}`,
    text: chunk.text,
    category: chunk.category,
    visibility: chunk.visibility,
    source: chunk.source,
    embedding,
  };

  const response = await fetch(
    `${supabaseUrl}/rest/v1/policy_chunks`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(databaseChunk),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Supabase ingest failed for ${chunk.id}: ` +
      `${response.status} ${await response.text()}`
    );
  }

  console.log(
    `Ingested ${visibility} policy chunk: ${chunk.id}`
  );
}
