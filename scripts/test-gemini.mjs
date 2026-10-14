
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error(
    'GEMINI_API_KEY is missing. Check your .env file.'
  );
}

const url =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent';

console.log('Testing Gemini text generation...');

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey,
  },
  body: JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: 'Reply with exactly: GEMINI_TEST_SUCCESS',
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
    },
  }),
});

const result = await response.json();

if (!response.ok) {
  console.error('Gemini API request failed.');
  console.error('HTTP status:', response.status);
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} else {
  const text =
    result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('') ?? '';

  if (!text) {
    console.error(
      'The request succeeded, but Gemini returned no text.'
    );
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Gemini response:', text);
    console.log('Gemini text generation test passed.');
  }
}
