const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error('GEMINI_API_KEY is missing. Check your .env file.');
}

const response = await fetch(
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      content: {
        parts: [{ text: 'A Reddit post violates the community rules.' }],
      },
      taskType: 'RETRIEVAL_QUERY',
      outputDimensionality: 768,
    }),
  }
);

const result = await response.json();

if (!response.ok) {
  console.error('Embedding request failed:', response.status);
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} else {
  const values = result.embedding?.values;

  if (!values?.length) {
    console.error('Gemini returned no embedding vector.');
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Embedding test passed.');
    console.log('Vector dimensions:', values.length);
    console.log('Sample values:', values.slice(0, 5));
  }
}