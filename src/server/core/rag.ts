import { embedText } from './gemini.js';
import type { PolicyChunk } from './types.js';

export async function retrievePolicy(apiKey: string, supabaseUrl: string, serviceKey: string, query: string, limit = 8): Promise<PolicyChunk[]> {
  if (!supabaseUrl || !serviceKey) throw new Error('Supabase settings are not configured');
  const embedding = await embedText(apiKey, query);
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/match_policy_chunks`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`
    },
    body: JSON.stringify({ query_embedding: embedding, match_threshold: 0.35, match_count: Math.min(12, limit) })
  });
  if (!response.ok) throw new Error(`Supabase retrieval failed: ${response.status} ${await response.text()}`);
  const rows = await response.json() as Array<any>;
  return rows.map((row) => ({
    id: String(row.id),
    text: String(row.text),
    category: String(row.category),
    visibility: row.visibility === 'private' ? 'private' : 'public',
    source: String(row.source ?? 'policy'),
    score: Number(row.similarity ?? 0)
  }));
}
