import { embedText } from './gemini.js';
import type { PolicyChunk, PolicyVisibility } from './types.js';

interface SupabasePolicyRow {
  id: string;
  text: string;
  category: string;
  visibility: string;
  source: string;
  similarity: number;
}

async function retrieveByVisibility(
  supabaseUrl: string,
  serviceKey: string,
  embedding: number[],
  visibility: PolicyVisibility,
  limit: number
): Promise<PolicyChunk[]> {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/rpc/match_policy_chunks`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        query_embedding: embedding,
        match_threshold: 0.35,
        match_count: Math.min(12, limit),
        match_visibility: visibility,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Supabase ${visibility} policy retrieval failed: ` +
      `${response.status} ${await response.text()}`
    );
  }

  const rows = await response.json() as SupabasePolicyRow[];

  return rows.map((row) => ({
    id: String(row.id),
    text: String(row.text),
    category: String(row.category),
    visibility,
    source: String(row.source ?? `${visibility}-policy`),
    score: Number(row.similarity ?? 0),
  }));
}

export async function retrievePolicy(
  apiKey: string,
  supabaseUrl: string,
  serviceKey: string,
  query: string,
  limit = 8
): Promise<PolicyChunk[]> {
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase settings are not configured');
  }

  // Generate one embedding for the content being moderated.
  const embedding = await embedText(apiKey, query);

  // Step 1: Search public subreddit rules.
  const publicChunks = await retrieveByVisibility(
    supabaseUrl,
    serviceKey,
    embedding,
    'public',
    limit
  );

  // Step 2: Search private moderator consensus.
  const privateChunks = await retrieveByVisibility(
    supabaseUrl,
    serviceKey,
    embedding,
    'private',
    limit
  );

  // Step 3: Preserve public-first ordering.
  return [...publicChunks, ...privateChunks];
}
