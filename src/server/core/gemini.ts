import type { ModerationDecision, PolicyChunk } from './types.js';

const GENERATE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent';
const EMBED_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';

function extractJson(
  text: string
): ModerationDecision {
  const fallback: ModerationDecision = {
    action: 'REVIEW',
    confidence: 0,
    summary:
      'Gemini returned an unusable moderation response.',
    violations: [],
    matchedRules: [],
    policyReferences: [],
  };

  try {
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    const parsed =
      JSON.parse(cleaned) as Partial<ModerationDecision>;

    const allowed = new Set([
      'ALLOW',
      'REMOVE',
      'BAN_PENDING',
      'REVIEW',
    ]);

    const action =
      String(parsed.action ?? '');

    return {
      action: allowed.has(action)
        ? action as ModerationDecision['action']
        : 'REVIEW',

      confidence: Math.max(
        0,
        Math.min(
          1,
          Number(parsed.confidence ?? 0)
        )
      ),

      summary:
        String(
          parsed.summary ??
          'No explanation was provided.'
        ),

      violations:
        Array.isArray(parsed.violations)
          ? parsed.violations.map(String)
          : [],

      matchedRules:
        Array.isArray(parsed.matchedRules)
          ? parsed.matchedRules.map(String)
          : [],

      policyReferences:
        Array.isArray(
          parsed.policyReferences
        )
          ? parsed.policyReferences.map(String)
          : [],
    };
  } catch (error) {
    console.error(
      'Failed to parse Gemini moderation JSON:',
      error
    );

    return fallback;
  }
}

export async function embedText(apiKey: string, text: string): Promise<number[]> {
  const response = await fetch(EMBED_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_QUERY',
      outputDimensionality: 768
    })
  });
  if (!response.ok) throw new Error(`Gemini embedding failed: ${response.status} ${await response.text()}`);
  const data = await response.json() as { embedding?: { values?: number[] } };
  if (!data.embedding?.values?.length) throw new Error('Gemini returned an empty embedding');
  return data.embedding.values;
}

export async function moderateWithGemini(
  apiKey: string,
  content: { kind: string; title?: string; body: string },
  chunks: PolicyChunk[]
): Promise<ModerationDecision> {
  const policy = chunks.map((chunk) =>
    `[${chunk.visibility.toUpperCase()}] ${chunk.id} | ${chunk.category}\n${chunk.text}`
  ).join('\n\n---\n\n');

  const system = `You are an AI moderation assistant for a Reddit community.\n\n` +
    `Use ONLY the supplied policy excerpts. Public and private policy may both affect the decision. ` +
    `Never reveal, quote, or mention that a rule came from private moderator policy.\n\n` +
    `Reason semantically; do not require exact keywords. If the supplied evidence does not establish a violation, ALLOW. ` +
    `If evidence is ambiguous or policies conflict, REVIEW. REMOVE is for established removable violations. ` +
    `BAN_PENDING is only a recommendation for a human moderator; you must never directly ban a user.\n\n` +
    `Return ONLY valid JSON matching this shape: {action, confidence, summary, violations, matchedRules, policyReferences}.`;

  const user = `CONTENT KIND: ${content.kind}\nTITLE: ${content.title ?? ''}\nBODY:\n${content.body}\n\nPOLICY EXCERPTS:\n${policy}`;

  const response = await fetch(GENERATE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    })
  });
  if (!response.ok) throw new Error(`Gemini generation failed: ${response.status} ${await response.text()}`);
  const data = await response.json() as any;
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error('Gemini returned no moderation decision');
  return extractJson(text);
}
