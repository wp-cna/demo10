import { reviewPostingSubmission } from "./openai.js";

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

function displayChecklistValue(value = "") {
  const normalized = String(value || "unclear").toLowerCase();

  if (normalized === "yes") return "YES";
  if (normalized === "no") return "NO";
  return "UNCLEAR";
}

function formatList(items = []) {
  if (!items.length) {
    return "None noted.";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function formatGuidelineChecklist(checklist = {}) {
  return Object.entries(CHECKLIST_LABELS)
    .map(([key, label]) => `${label}: ${displayChecklistValue(checklist[key])}`)
    .join("\n");
}

function formatOriginalSubmission(raw = {}) {
  return [
    `Name: ${raw.name}`,
    `Email: ${raw.email}`,
    `Subject: ${raw.subject}`,
    "",
    "Message:",
    raw.message
  ].join("\n");
}

function formatEmailBody({ review, rawSubmission, timestamp, request }) {
  const cleanedSummary = review.cleanedUpDraftSummary
    ? review.cleanedUpDraftSummary
    : "Not included. The submission may need more information or human review before a summary is drafted.";

  return [
    "AI REVIEW",
    `Recommendation: ${review.recommendation}`,
    `Reason: ${review.reason}`,
    "Missing information:",
    formatList(review.missingInformation),
    `Suggested follow-up: ${review.suggestedFollowUp || "None suggested."}`,
    "",
    "GUIDELINE CHECKLIST",
    formatGuidelineChecklist(review.checklist),
    "",
    "CLEANED-UP DRAFT SUMMARY",
    cleanedSummary,
    "",
    "ORIGINAL SUBMISSION",
    formatOriginalSubmission(rawSubmission),
    "",
    "TECHNICAL FOOTER",
    `Submission timestamp: ${timestamp}`,
    `Page/source: ${rawSubmission.pageSource || request.headers.get("Referer") || "Unknown"}`,
    "No public posting was created automatically."
  ].join("\n");
}

function emailSubject(subject = "") {
  const cleanSubject = normalizeText(subject, 120) || "Untitled submission";
  return `Community Posting Review: ${cleanSubject}`;
}

async function sendViaResend({ env, subject, body, replyTo }) {
  const from = env.POSTING_EMAIL_FROM || "WPCNA <onboarding@resend.dev>";
  const recipient = env.POSTING_RECIPIENT_EMAIL;

  if (!env.RESEND_API_KEY || !recipient) {
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
      to: [recipient],
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
  payload.set("AI and submission review", body);

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

  let review;

  try {
    review = await reviewPostingSubmission({
      env,
      submission: {
        name: clean.name,
        email: clean.email,
        subject: clean.subject,
        message: clean.message,
        pageSource: clean.pageSource
      }
    });
  } catch (error) {
    console.error("Posting AI review error:", error);
    return errorResponse("The review service is not available right now. Please try again later.", 502, corsHeaders);
  }

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
