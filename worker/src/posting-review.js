const POSTING_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const POSTING_RATE_LIMIT_MAX = 5;
const POSTING_MAX_LENGTHS = {
  name: 120,
  email: 254,
  subject: 200,
  message: 4000,
  website: 500
};
const postingRateLimitStore = new Map();

const RECOMMENDATIONS = {
  ready: "READY FOR HUMAN REVIEW",
  needs: "NEEDS MORE INFORMATION",
  outside: "LIKELY OUTSIDE GUIDELINES",
  escalate: "ESCALATE TO HUMAN"
};

const CHECKLIST_LABELS = {
  relevantToWhitePlainsResidents: "Relevant to White Plains residents",
  communityServing: "Community-serving",
  civicEducationalPublicInterestPurpose: "Neighborhood/civic/educational/public-interest purpose",
  notPrivateClassifiedListing: "Not a private classified/listing",
  notCommercialAdvertising: "Not commercial advertising",
  notPersonalDisputeOrComplaint: "Not a personal dispute or complaint",
  notUrgentEmergencyMessaging: "Not urgent emergency messaging",
  includesDateIfTimeBased: "Includes date if time-based",
  includesTimeIfTimeBased: "Includes time if time-based",
  includesLocationIfLocationBased: "Includes location if location-based",
  includesOrganizerSource: "Includes organizer/source",
  includesContactInformationForFollowUp: "Includes contact information for follow-up"
};

const LOCAL_TERMS = [
  "white plains",
  "wp",
  "wpcna",
  "battle hill",
  "bronx river",
  "bryant gardens",
  "carhart",
  "church street",
  "eastview",
  "ferris",
  "fisher hill",
  "gedney",
  "good counsel",
  "highlands",
  "north broadway",
  "north street",
  "old oak ridge",
  "prospect park",
  "rosedale",
  "soundview",
  "westchester avenue",
  "westminster ridge",
  "woodcrest"
];

const EVENT_TERMS = [
  "block party",
  "cleanup",
  "clinic",
  "class",
  "event",
  "festival",
  "gathering",
  "meeting",
  "night",
  "parade",
  "picnic",
  "presentation",
  "program",
  "session",
  "tour",
  "walk",
  "workshop"
];

const COMMUNITY_TERMS = [
  "association",
  "block party",
  "civic",
  "cleanup",
  "community",
  "educational",
  "family",
  "garden",
  "guide",
  "library",
  "neighbors",
  "neighborhood",
  "public",
  "residents",
  "safety",
  "school",
  "volunteer",
  "workshop"
];

const OUTSIDE_RULES = [
  ["Yard sale", /\byard sale\b/i],
  ["Garage sale", /\bgarage sale\b/i],
  ["Personal item for sale", /\b(for sale|selling|item listing|personal item)\b/i],
  ["Discount/coupon/promotion", /\b(discount|coupon|promo|promotion|limited time offer)\b/i],
  ["Business/service advertisement", /\b(private tutoring|business service|service advertisement|book now|free estimate|hire me)\b/i],
  ["Real estate listing", /\b(real estate|open house|apartment rental|room for rent|lease available|condo for sale)\b/i],
  ["Job listing", /\b(job listing|hiring|now hiring|apply for this job|employment opportunity)\b/i],
  ["Private-benefit fundraiser", /\b(fundraiser|gofundme|donate to my|donate to our family)\b/i],
  ["Unrelated city focus", /\b(yonkers|scarsdale|new rochelle|rye|mamaroneck|harrison|bronxville|greenburgh)\b/i]
];

const ESCALATION_RULES = [
  ["Emergency or immediate danger", /\b(urgent emergency|immediate danger|call 911|evacuate|active threat)\b/i],
  ["Crime or accusation", /\b(stole|theft|assault|fraud|crime|criminal|illegal activity|accused|police report)\b/i],
  ["Named personal complaint", /\b(complaint against|harassment by|neighbor is|landlord is|tenant is)\b/i],
  ["Legal claim", /\b(lawsuit|sue|attorney|legal claim|court case|subpoena)\b/i],
  ["Medical advice or claim", /\b(medical advice|diagnosis|medication|cure|treatment plan|health claim)\b/i],
  ["Discriminatory or hateful language", /\b(discriminatory|racist|hate speech|slur)\b/i],
  ["Political campaign content", /\b(vote for|elect|candidate|campaign fundraiser|political campaign)\b/i],
  ["Threats or harassment", /\b(threat|threaten|harass|harassment|retaliation)\b/i],
  ["Defamatory or accusatory language", /\b(defamatory|corrupt|scam artist|dangerous person)\b/i]
];

function normalizeText(value = "", maxLength = 4000) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .slice(0, maxLength)
    .trim();
}

function rawText(value = "", maxLength = 4000) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .slice(0, maxLength);
}

function safeEmailText(value = "", maxLength = 4000) {
  return rawText(value, maxLength)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

function normalizeEmail(value = "") {
  return normalizeText(value, POSTING_MAX_LENGTHS.email).toLowerCase();
}

function isEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getClientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
}

function isPostingRateLimited(ipAddress) {
  const now = Date.now();

  for (const [ip, state] of postingRateLimitStore.entries()) {
    if (now - state.startedAt > POSTING_RATE_LIMIT_WINDOW_MS) {
      postingRateLimitStore.delete(ip);
    }
  }

  const current = postingRateLimitStore.get(ipAddress);

  if (!current) {
    postingRateLimitStore.set(ipAddress, { startedAt: now, count: 1 });
    return false;
  }

  current.count += 1;
  return current.count > POSTING_RATE_LIMIT_MAX;
}

async function parseSubmissionRequest(request) {
  const contentType = request.headers.get("Content-Type") || "";
  let body = {};

  if (contentType.includes("application/json")) {
    body = await request.json();
  } else {
    const formData = await request.formData();
    body = Object.fromEntries(formData.entries());
  }

  const raw = {
    name: rawText(body.name, POSTING_MAX_LENGTHS.name),
    email: rawText(body.email, POSTING_MAX_LENGTHS.email),
    subject: rawText(body.subject, POSTING_MAX_LENGTHS.subject),
    message: rawText(body.message, POSTING_MAX_LENGTHS.message),
    website: rawText(body.website, POSTING_MAX_LENGTHS.website),
    pageSource: rawText(body.pageSource || request.headers.get("Referer") || "", 500)
  };

  const clean = {
    name: normalizeText(raw.name, POSTING_MAX_LENGTHS.name),
    email: normalizeEmail(raw.email),
    subject: normalizeText(raw.subject, POSTING_MAX_LENGTHS.subject),
    message: normalizeText(raw.message, POSTING_MAX_LENGTHS.message),
    website: normalizeText(raw.website, POSTING_MAX_LENGTHS.website),
    pageSource: normalizeText(raw.pageSource, 500)
  };

  return { raw, clean };
}

function validateSubmission(submission) {
  const missing = ["name", "email", "subject", "message"].filter((field) => !submission[field]);

  if (missing.length) {
    return `Please complete ${missing.join(", ")}.`;
  }

  if (!isEmail(submission.email)) {
    return "Please enter a valid email address.";
  }

  if (submission.subject.length < 3 || submission.message.length < 10) {
    return "Please include enough detail for WPCNA to review the posting.";
  }

  return "";
}

function includesAny(text, terms) {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function matchesRules(text, rules) {
  return rules
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
}

function hasConcreteDate(text) {
  return [
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?\b/i,
    /\b\d{1,2}(?:st|nd|rd|th)?\s+of\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\b/i,
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/
  ].some((pattern) => pattern.test(text));
}

function hasConcreteTime(text) {
  return [
    /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i,
    /\b\d{1,2}\s*[-\u2013]\s*\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?)\b/i,
    /\bnoon\b/i
  ].some((pattern) => pattern.test(text));
}

function hasLocation(text) {
  return /\b(?:avenue|ave\.?|street|st\.?|road|rd\.?|lane|ln\.?|park|library|school|hall|center|centre|entrance|greenway|plaza|parking lot|playground|field|church|temple|synagogue)\b/i.test(text);
}

function isEmergencyPreparedness(text) {
  return /\bemergency preparedness\b/i.test(text);
}

function wordCount(text) {
  return normalizeText(text).split(/\s+/).filter(Boolean).length;
}

function checklistValue(condition, fallback = "unclear") {
  if (condition === true) return "yes";
  if (condition === false) return "no";
  return fallback;
}

function cleanedDraftSummary(submission) {
  const firstSentence = normalizeText(submission.message)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => item.trim())
    .filter(Boolean)[0] || submission.message;

  return `${submission.subject}: ${firstSentence}`.slice(0, 320);
}

function reviewPostingSubmission(submission) {
  const text = `${submission.subject}\n${submission.message}\n${submission.name}`.trim();
  const lower = text.toLowerCase();
  const eventLike = includesAny(lower, EVENT_TERMS);
  const local = includesAny(lower, LOCAL_TERMS);
  const communityServing = includesAny(lower, COMMUNITY_TERMS);
  const outsideFlags = matchesRules(text, OUTSIDE_RULES).filter((label) => {
    if (label === "Unrelated city focus") {
      return !local;
    }
    return true;
  });
  const escalationFlags = matchesRules(text, ESCALATION_RULES).filter((label) => {
    if (label === "Emergency or immediate danger") {
      return !isEmergencyPreparedness(text);
    }
    return true;
  });
  const missingInformation = [];

  if (!local) {
    missingInformation.push("White Plains or neighborhood relevance");
  }

  if (!communityServing) {
    missingInformation.push("Community-serving purpose");
  }

  if (eventLike && !hasConcreteDate(text)) {
    missingInformation.push("Specific date");
  }

  if (eventLike && !hasConcreteTime(text)) {
    missingInformation.push("Specific time");
  }

  if (eventLike && !hasLocation(text)) {
    missingInformation.push("Specific location");
  }

  if (wordCount(submission.message) < 12) {
    missingInformation.push("More description");
  }

  const checklist = {
    relevantToWhitePlainsResidents: checklistValue(local),
    communityServing: checklistValue(communityServing),
    civicEducationalPublicInterestPurpose: checklistValue(communityServing || local),
    notPrivateClassifiedListing: checklistValue(!outsideFlags.some((flag) => /sale|rental|listing|job/i.test(flag))),
    notCommercialAdvertising: checklistValue(!outsideFlags.some((flag) => /discount|business|real estate|job/i.test(flag))),
    notPersonalDisputeOrComplaint: checklistValue(!escalationFlags.some((flag) => /complaint|accusation|defamatory/i.test(flag))),
    notUrgentEmergencyMessaging: checklistValue(!escalationFlags.some((flag) => /emergency/i.test(flag))),
    includesDateIfTimeBased: eventLike ? checklistValue(hasConcreteDate(text)) : "unclear",
    includesTimeIfTimeBased: eventLike ? checklistValue(hasConcreteTime(text)) : "unclear",
    includesLocationIfLocationBased: eventLike ? checklistValue(hasLocation(text)) : "unclear",
    includesOrganizerSource: checklistValue(Boolean(submission.name)),
    includesContactInformationForFollowUp: checklistValue(Boolean(submission.email))
  };

  let recommendation = RECOMMENDATIONS.ready;
  let reason = "Submission appears complete enough for WPCNA human review.";
  let suggestedFollowUp = "None.";
  let summary = cleanedDraftSummary(submission);

  if (escalationFlags.length) {
    recommendation = RECOMMENDATIONS.escalate;
    reason = "Submission includes sensitive or potentially high-risk material that should be reviewed carefully by a person.";
    suggestedFollowUp = "Please review the original submission before responding or taking any action.";
    summary = "";
  } else if (outsideFlags.length) {
    recommendation = RECOMMENDATIONS.outside;
    reason = "Submission includes signs of commercial, private-listing, unrelated, or otherwise outside-guideline content.";
    suggestedFollowUp = "Please confirm whether the item has a clear White Plains community-serving purpose.";
    summary = "";
  } else if (missingInformation.length) {
    recommendation = RECOMMENDATIONS.needs;
    reason = "Submission may be appropriate but is missing details needed for review.";
    suggestedFollowUp = `Could you provide: ${missingInformation.join(", ")}?`;
  }

  return {
    recommendation,
    reason,
    triggeredFlags: [...escalationFlags, ...outsideFlags],
    missingInformation,
    suggestedFollowUp,
    cleanedUpDraftSummary: summary,
    checklist
  };
}

function displayChecklistValue(value = "") {
  const normalized = String(value || "unclear").toLowerCase();

  if (normalized === "yes") return "Yes";
  if (normalized === "no") return "No";
  return "Unclear";
}

function formatList(items = []) {
  if (!items.length) {
    return "None noted.";
  }

  return items.map((item) => `- ${safeEmailText(item, 500)}`).join("\n");
}

function formatGuidelineChecklist(checklist = {}) {
  return Object.entries(CHECKLIST_LABELS)
    .map(([key, label]) => `${label}: ${displayChecklistValue(checklist[key])}`)
    .join("\n");
}

function formatOriginalSubmission(raw = {}) {
  return [
    `Name: ${safeEmailText(raw.name, POSTING_MAX_LENGTHS.name)}`,
    `Email: ${safeEmailText(raw.email, POSTING_MAX_LENGTHS.email)}`,
    `Subject: ${safeEmailText(raw.subject, POSTING_MAX_LENGTHS.subject)}`,
    "",
    "Message:",
    safeEmailText(raw.message, POSTING_MAX_LENGTHS.message)
  ].join("\n");
}

function formatEmailBody({ review, rawSubmission, timestamp, request }) {
  const sections = [
    "RULE-BASED REVIEW",
    `Recommendation: ${review.recommendation}`,
    `Reason: ${review.reason}`,
    "Triggered flags:",
    formatList(review.triggeredFlags),
    "Missing information:",
    formatList(review.missingInformation),
    `Suggested follow-up: ${review.suggestedFollowUp || "None suggested."}`,
    "",
    "GUIDELINE CHECKLIST",
    formatGuidelineChecklist(review.checklist)
  ];

  if (
    review.cleanedUpDraftSummary &&
    [RECOMMENDATIONS.ready, RECOMMENDATIONS.needs].includes(review.recommendation)
  ) {
    sections.push("", "CLEANED-UP DRAFT SUMMARY", safeEmailText(review.cleanedUpDraftSummary, 600));
  }

  sections.push(
    "",
    "ORIGINAL SUBMISSION",
    formatOriginalSubmission(rawSubmission),
    "",
    "TECHNICAL FOOTER",
    `Submission timestamp: ${timestamp}`,
    `Page/source: ${safeEmailText(rawSubmission.pageSource || request.headers.get("Referer") || "Unknown", 500)}`,
    "No secrets are included.",
    "No public posting was created automatically."
  );

  return sections.join("\n");
}

function emailSubject(subject = "") {
  const cleanSubject = normalizeText(subject, 120) || "Untitled submission";
  return `Community Posting Review: ${cleanSubject}`;
}

function parseEmailList(value = "") {
  return String(value || "")
    .split(",")
    .map((email) => normalizeEmail(email))
    .filter((email) => email && isEmail(email));
}

function postingRecipients(env) {
  const recipients = [
    ...parseEmailList(env.POSTING_RECIPIENT_EMAILS),
    ...parseEmailList(env.POSTING_RECIPIENT_EMAIL)
  ];

  return [...new Set(recipients)];
}

async function sendViaResend({ env, subject, body, replyTo }) {
  const from = env.POSTING_EMAIL_FROM || "WPCNA <onboarding@resend.dev>";
  const recipients = postingRecipients(env);

  if (!env.RESEND_API_KEY || !recipients.length) {
    return false;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from,
      to: recipients,
      subject,
      text: body,
      reply_to: replyTo ? [replyTo] : undefined
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend email failed with ${response.status}: ${detail}`);
  }

  return true;
}

async function sendViaWebhook({ env, subject, body, replyTo }) {
  const webhookUrl = env.POSTING_EMAIL_WEBHOOK_URL;

  if (!webhookUrl) {
    return false;
  }

  const payload = new URLSearchParams();
  payload.set("_subject", subject);
  payload.set("_template", "table");
  payload.set("_captcha", "false");
  if (replyTo) {
    payload.set("_replyto", replyTo);
  }
  const cc = parseEmailList(env.POSTING_CC_EMAILS).join(",");
  if (cc) {
    payload.set("_cc", cc);
  }
  payload.set("Rule-based posting review", body);

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: payload
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Email webhook failed with ${response.status}: ${detail}`);
  }

  return true;
}

async function sendPostingReviewEmail({ env, subject, body, replyTo }) {
  if (await sendViaResend({ env, subject, body, replyTo })) {
    return;
  }

  if (await sendViaWebhook({ env, subject, body, replyTo })) {
    return;
  }

  throw new Error("No posting email provider is configured.");
}

export async function handlePostingSubmission({ request, env, corsHeaders, jsonResponse, errorResponse }) {
  if (request.method !== "POST") {
    return errorResponse("Method not allowed.", 405, corsHeaders);
  }

  const ipAddress = getClientIp(request);

  if (isPostingRateLimited(ipAddress)) {
    return errorResponse("Too many submissions. Please try again in a few minutes.", 429, corsHeaders);
  }

  let parsed;

  try {
    parsed = await parseSubmissionRequest(request);
  } catch {
    return errorResponse("Invalid submission.", 400, corsHeaders);
  }

  const { raw, clean } = parsed;

  if (clean.website) {
    return jsonResponse({ ok: true, message: "Submission received for review." }, 200, corsHeaders);
  }

  const validationError = validateSubmission(clean);

  if (validationError) {
    return errorResponse(validationError, 422, corsHeaders);
  }

  const review = reviewPostingSubmission({
    name: clean.name,
    email: clean.email,
    subject: clean.subject,
    message: clean.message,
    pageSource: clean.pageSource
  });

  const timestamp = new Date().toISOString();
  const subject = emailSubject(clean.subject);
  const body = formatEmailBody({
    review,
    rawSubmission: raw,
    timestamp,
    request
  });

  try {
    await sendPostingReviewEmail({
      env,
      subject,
      body,
      replyTo: clean.email
    });
  } catch (error) {
    console.error("Posting email error:", error);
    return errorResponse("The submission could not be emailed right now. Please try again later.", 502, corsHeaders);
  }

  return jsonResponse(
    {
      ok: true,
      message: "Submission received. WPCNA will review it before anything is posted."
    },
    200,
    corsHeaders
  );
}
