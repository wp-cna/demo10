const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5-mini";
const FALLBACK_ANSWER = "I do not have enough information from the current WPCNA sources.";

const SYSTEM_PROMPT = [
  "You are Ask White Plains, a civic assistant for the WPCNA website.",
  "Use only the provided source excerpts.",
  `If the sources do not support an answer, say exactly: "${FALLBACK_ANSWER}"`,
  "Keep answers concise, useful, plainspoken, and grounded in the retrieved content.",
  "This can include White Plains history only when that history is supported by the provided site sources.",
  "Do not invent facts or rely on outside knowledge.",
  "Do not provide emergency, legal, medical, real estate, school ranking, safety, or official government advice.",
  "If the question asks for official city help and the sources do not include that information, use the fallback sentence.",
  "Do not include source numbers or markdown citations in the answer text."
].join(" ");

function formatSources(sources) {
  return sources
    .map((source, index) => [
      `Source ${index + 1}: ${source.title}`,
      `URL: ${source.url}`,
      `Type: ${source.type}`,
      `Excerpt: ${source.text}`
    ].join("\n"))
    .join("\n\n");
}

function extractOutputText(payload = {}) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const parts = [];

  for (const item of payload.output || []) {
    if (!Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (typeof content.text === "string" && content.text.trim()) {
        parts.push(content.text.trim());
      }
    }
  }

  return parts.join("\n").trim();
}

export async function generateAnswer({ env, question, sources }) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const response = await fetch(env.OPENAI_API_URL || OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || DEFAULT_MODEL,
      store: false,
      max_output_tokens: 320,
      instructions: SYSTEM_PROMPT,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Question: ${question}`,
                "",
                "Answer only from these WPCNA source excerpts:",
                formatSources(sources)
              ].join("\n")
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI request failed with ${response.status}: ${detail}`);
  }

  const payload = await response.json();
  const answer = extractOutputText(payload);

  return answer || FALLBACK_ANSWER;
}

export { FALLBACK_ANSWER };
