import fs from 'node:fs/promises';

const policyPath = process.argv[2] ?? 'policy/policy.json';
const geminiKey = process.env.GEMINI_API_KEY;
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!geminiKey || !supabaseUrl || !supabaseKey) {
  throw new Error('Set GEMINI_API_KEY, SUPABASE_URL, and SUPABASE_SERVICE_KEY before ingesting policy.');
}

const chunks = JSON.parse(await fs.readFile(policyPath, 'utf8')) as Array<{
  id: string; text: string; category: string; visibility: 'public' | 'private'; source: string;
}>;

for (const chunk of chunks) {
  const embeddingResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey },
    body: JSON.stringify({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text: chunk.text }] },
      taskType: 'RETRIEVAL_DOCUMENT',
      outputDimensionality: 768
    })
  });
  if (!embeddingResponse.ok) throw new Error(await embeddingResponse.text());
  const data = await embeddingResponse.json() as any;
  const embedding = data.embedding.values;

  const response = await fetch(`${supabaseUrl}/rest/v1/policy_chunks`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify({ ...chunk, embedding })
  });
  if (!response.ok) throw new Error(`Supabase ingest failed: ${response.status} ${await response.text()}`);
  console.log(`Ingested ${chunk.id}`);
}
