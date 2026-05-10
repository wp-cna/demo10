const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5-mini";
const FALLBACK_ANSWER = "I do not have enough information from the current WPCNA sources.";
const POSTING_REVIEW_FALLBACK = {
  recommendation: "ESCALATE TO HUMAN",
  reason: "The AI review could not be parsed reliably, so the submission should be reviewed manually.",
  missingInformation: ["Manual review required"],
  suggestedFollowUp: "Please review the original submission directly before taking any action.",
  cleanedUpDraftSummary: "",
  checklist: {
    relevantToWhitePlainsResidents: "unclear",
    communityServing: "unclear",
    civicEducationalPublicInterestPurpose: "unclear",
    notPrivateClassifiedListing: "unclear",
    notCommercialAdvertising: "unclear",
    notPersonalDisputeOrComplaint: "unclear",
    notUrgentEmergencyMessaging: "unclear",
    includesDateIfTimeBased: "unclear",
    includesTimeIfTimeBased: "unclear",
    includesLocationIfLocationBased: "unclear",
    includesOrganizerSource: "unclear",
    includesContactInformationForFollowUp: "unclear"
  }
};

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

function extractJsonObject(text = "") {
  const trimmed = String(text || "").trim();

  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);

    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeReviewLabel(value = "") {
  const normalized = String(value || "").trim().toUpperCase();
  const allowed = new Set([
    "APPROVE FOR HUMAN REVIEW",
    "NEEDS MORE INFORMATION",
    "LIKELY OUTSIDE GUIDELINES",
    "ESCALATE TO HUMAN"
  ]);

  return allowed.has(normalized) ? normalized : "ESCALATE TO HUMAN";
}

function normalizeChecklistValue(value = "") {
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === "yes" || normalized === "no" || normalized === "unclear") {
    return normalized;
  }

  return "unclear";
}

function normalizePostingReview(review) {
  if (!review || typeof review !== "object") {
    return POSTING_REVIEW_FALLBACK;
  }

  const checklist = review.checklist && typeof review.checklist === "object" ? review.checklist : {};
  const normalizedChecklist = {};

  for (const key of Object.keys(POSTING_REVIEW_FALLBACK.checklist)) {
    normalizedChecklist[key] = normalizeChecklistValue(checklist[key]);
  }

  const missingInformation = Array.isArray(review.missingInformation)
    ? review.missingInformation.map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
    : String(review.missingInformation || "")
      .split(/\n|;/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);

  return {
    recommendation: normalizeReviewLabel(review.recommendation),
    reason: String(review.reason || POSTING_REVIEW_FALLBACK.reason).trim(),
    missingInformation,
    suggestedFollowUp: String(review.suggestedFollowUp || "").trim(),
    cleanedUpDraftSummary: String(review.cleanedUpDraftSummary || "").trim(),
    checklist: normalizedChecklist
  };
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

export async function reviewPostingSubmission({ env, submission }) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const instructions = [
    "You are privately assisting WPCNA with Community Posting intake review.",
    "This is vetting only. Never approve, reject, publish, or tell the submitter anything.",
    "Compare the submission against WPCNA Community Posting standards: local White Plains relevance, community-serving purpose, civic/educational/public-interest usefulness, not classified advertising, not personal disputes, not urgent emergency messaging, and sufficient practical details.",
    "Be conservative. If uncertain, mark ESCALATE TO HUMAN.",
    "If potentially defamatory, accusatory, political, legal, medical, emergency-related, discriminatory, or safety-critical, mark ESCALATE TO HUMAN.",
    "Return only a JSON object with these exact keys: recommendation, reason, missingInformation, suggestedFollowUp, cleanedUpDraftSummary, checklist.",
    "recommendation must be one of: APPROVE FOR HUMAN REVIEW, NEEDS MORE INFORMATION, LIKELY OUTSIDE GUIDELINES, ESCALATE TO HUMAN.",
    "missingInformation must be an array of short strings.",
    "cleanedUpDraftSummary may be empty if the item seems unsuitable or too unclear.",
    "checklist values must be yes, no, or unclear for each checklist key."
  ].join(" ");

  const response = await fetch(env.OPENAI_API_URL || OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: env.POSTING_REVIEW_MODEL || env.OPENAI_MODEL || DEFAULT_MODEL,
      store: false,
      max_output_tokens: 900,
      instructions,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Review this Community Posting submission for WPCNA.",
                "",
                "Checklist keys:",
                "- relevantToWhitePlainsResidents",
                "- communityServing",
                "- civicEducationalPublicInterestPurpose",
                "- notPrivateClassifiedListing",
                "- notCommercialAdvertising",
                "- notPersonalDisputeOrComplaint",
                "- notUrgentEmergencyMessaging",
                "- includesDateIfTimeBased",
                "- includesTimeIfTimeBased",
                "- includesLocationIfLocationBased",
                "- includesOrganizerSource",
                "- includesContactInformationForFollowUp",
                "",
                "Submission:",
                JSON.stringify(submission, null, 2)
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
  const parsed = extractJsonObject(extractOutputText(payload));

  return normalizePostingReview(parsed);
}

export { FALLBACK_ANSWER };
