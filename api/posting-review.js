const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const SUCCESS_MESSAGE = "Thank you. Your submission has been received and is being reviewed by WPCNA.";
const MAX = {
  title: 160,
  category: 80,
  postingType: 80,
  eventDate: 40,
  eventTime: 80,
  location: 220,
  intendedAudience: 80,
  whitePlainsAffiliation: 180,
  contactName: 140,
  contactEmail: 180,
  organizationName: 180,
  fundraising: 20,
  linksIncluded: 20,
  description: 1800,
  pageSource: 500,
  honeypot: 120
};

const REQUIRED_FIELDS = [
  "title",
  "category",
  "postingType",
  "whitePlainsAffiliation",
  "contactName",
  "contactEmail",
  "fundraising",
  "linksIncluded",
  "guidelinesConfirmed",
  "description"
];

const CHECK_NAMES = [
  "localRelevance",
  "civicCommunityOrientation",
  "commercialIntent",
  "spamLikelihood",
  "appropriateness",
  "publicInterestValue",
  "safetyConcerns",
  "fundraisingConcerns",
  "accusationsOrPoliticalSensitivity",
  "suitableForWpcnaAudience"
];

const SPAM_PHRASES = [
  "act now",
  "bitcoin",
  "casino",
  "cheap pills",
  "click here",
  "coupon",
  "crypto",
  "discount",
  "earn money",
  "free money",
  "guaranteed income",
  "limited time offer",
  "loan offer",
  "make money fast",
  "seo services",
  "viagra",
  "winner"
];

const EVENT_LIKE_TYPES = new Set(["event", "meeting", "volunteer opportunity"]);

function cleanText(value = "", max = 500) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function normalizeList(value, max = 80) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map((item) => cleanText(item, max)).filter(Boolean).slice(0, 12);
}

function normalizeEmail(value = "") {
  return cleanText(value, MAX.contactEmail).toLowerCase();
}

function isEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseRecipients(value = "") {
  return String(value || "")
    .split(",")
    .map((email) => normalizeEmail(email))
    .filter((email) => email && isEmail(email));
}

function safeEmailText(value = "", max = 2000) {
  return cleanText(value, max).replace(/[<>]/g, "");
}

function allCapsRatio(text = "") {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 8) return 0;
  const caps = letters.replace(/[^A-Z]/g, "").length;
  return caps / letters.length;
}

function countLinks(text = "") {
  return (text.match(/https?:\/\/|www\.|\.com\b|\.org\b|\.net\b|\.io\b/gi) || []).length;
}

function hasRepeatedText(text = "") {
  const normalized = text.toLowerCase();
  if (/(.)\1{8,}/.test(normalized)) return true;
  const words = normalized.split(/\s+/).filter((word) => word.length > 3);
  if (words.length < 20) return false;
  const unique = new Set(words);
  return unique.size / words.length < 0.35;
}

function looksGibberish(text = "") {
  const letters = text.toLowerCase().replace(/[^a-z]/g, "");
  if (!letters) return true;
  if (letters.length < 20) return true;
  const vowels = (letters.match(/[aeiou]/g) || []).length;
  const vowelRatio = vowels / letters.length;
  const nonWordRatio = (text.replace(/[A-Za-z0-9\s.,;:'"!?()&/-]/g, "").length || 0) / Math.max(text.length, 1);
  return vowelRatio < 0.18 || nonWordRatio > 0.2;
}

function check(status, detail = "") {
  return { status, detail };
}

function normalizeSubmission(body = {}) {
  const description = cleanText(firstValue(body.description, body.message), MAX.description);
  const title = cleanText(firstValue(body.title, body.subject), MAX.title);
  return {
    title,
    category: cleanText(body.category, MAX.category),
    postingType: cleanText(body.postingType, MAX.postingType),
    eventDate: cleanText(body.eventDate, MAX.eventDate),
    eventTime: cleanText(body.eventTime, MAX.eventTime),
    location: cleanText(body.location, MAX.location),
    intendedAudience: normalizeList(firstValue(body.intendedAudience, body.audience), MAX.intendedAudience),
    whitePlainsAffiliation: cleanText(body.whitePlainsAffiliation, MAX.whitePlainsAffiliation),
    contactName: cleanText(firstValue(body.contactName, body.name), MAX.contactName),
    contactEmail: normalizeEmail(firstValue(body.contactEmail, body.email)),
    organizationName: cleanText(firstValue(body.organizationName, body.organization), MAX.organizationName),
    fundraising: cleanText(body.fundraising, MAX.fundraising),
    linksIncluded: cleanText(body.linksIncluded, MAX.linksIncluded),
    guidelinesConfirmed: cleanText(body.guidelinesConfirmed, 20).toLowerCase(),
    description,
    pageSource: cleanText(body.pageSource, MAX.pageSource),
    honeypot: cleanText(firstValue(body.website, body._honey), MAX.honeypot),
    original: {
      ...body,
      title,
      contactName: cleanText(firstValue(body.contactName, body.name), MAX.contactName),
      contactEmail: normalizeEmail(firstValue(body.contactEmail, body.email)),
      organizationName: cleanText(firstValue(body.organizationName, body.organization), MAX.organizationName),
      intendedAudience: normalizeList(firstValue(body.intendedAudience, body.audience), MAX.intendedAudience),
      description
    }
  };
}

function runMechanicalChecks(submission) {
  const missing = REQUIRED_FIELDS.filter((field) => !submission[field]);
  const descriptionLinkCount = countLinks(submission.description);
  const allText = [
    submission.title,
    submission.category,
    submission.postingType,
    submission.organizationName,
    submission.location,
    submission.whitePlainsAffiliation,
    submission.description
  ].join(" ");
  const lower = allText.toLowerCase();
  const spamMatches = SPAM_PHRASES.filter((phrase) => lower.includes(phrase));
  const eventLike = EVENT_LIKE_TYPES.has(submission.postingType.toLowerCase());
  const missingEventDetails = [];

  if (eventLike && !submission.eventDate) missingEventDetails.push("event date");
  if (eventLike && !submission.eventTime) missingEventDetails.push("event time");
  if (eventLike && !submission.location) missingEventDetails.push("location");

  const results = {
    requiredFieldsPresent: check(missing.length ? "fail" : "pass", missing.join(", ")),
    validEmail: check(isEmail(submission.contactEmail) ? "pass" : "fail"),
    minimumDescriptionLength: check(
      submission.description.length >= 40 ? "pass" : "fail",
      `${submission.description.length} characters`
    ),
    suspiciousLinkCount: check(
      descriptionLinkCount > 3 ? "fail" : descriptionLinkCount > 1 ? "warning" : "pass",
      `${descriptionLinkCount} link-like reference${descriptionLinkCount === 1 ? "" : "s"}`
    ),
    repeatedText: check(hasRepeatedText(allText) ? "fail" : "pass"),
    basicSpamPhrase: check(spamMatches.length ? "fail" : "pass", spamMatches.join(", ")),
    allCapsTitle: check(allCapsRatio(submission.title) > 0.8 ? "warning" : "pass"),
    emptyOrGibberish: check(looksGibberish(submission.description) ? "fail" : "pass"),
    eventDetailsPresent: check(missingEventDetails.length ? "warning" : "pass", missingEventDetails.join(", "))
  };

  const hardFailures = Object.entries(results)
    .filter(([key, value]) =>
      ["requiredFieldsPresent", "validEmail", "minimumDescriptionLength", "emptyOrGibberish"].includes(key) &&
      value.status === "fail"
    )
    .map(([key]) => key);

  return { results, hardFailures };
}

function mechanicalSummary(mechanicalChecks) {
  return Object.entries(mechanicalChecks.results)
    .map(([key, value]) => `${key}: ${value.status.toUpperCase()}${value.detail ? ` (${value.detail})` : ""}`)
    .join("\n");
}

function defaultModeration(status = "needs_review", reason = "Moderation fallback used.") {
  return {
    status,
    confidence: 0,
    reason,
    publicMessage: "Your submission has been received and will be reviewed by WPCNA.",
    checks: Object.fromEntries(CHECK_NAMES.map((name) => [name, "uncertain"]))
  };
}

function normalizeModeration(value = {}) {
  const allowed = new Set(["approved", "needs_review", "rejected"]);
  const status = allowed.has(value.status) ? value.status : "needs_review";
  const confidence = Math.max(0, Math.min(1, Number(value.confidence) || 0));
  const checks = {};

  CHECK_NAMES.forEach((name) => {
    checks[name] = ["pass", "fail", "uncertain"].includes(value.checks?.[name])
      ? value.checks[name]
      : "uncertain";
  });

  return {
    status,
    confidence,
    reason: cleanText(value.reason, 900) || "No reason returned.",
    publicMessage: cleanText(value.publicMessage, 300) || "Your submission has been received.",
    checks
  };
}

async function runOpenAiModeration(submission, mechanicalChecks) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const schema = {
    name: "wpcna_posting_moderation",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["status", "confidence", "reason", "publicMessage", "checks"],
      properties: {
        status: { type: "string", enum: ["approved", "needs_review", "rejected"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        reason: { type: "string" },
        publicMessage: { type: "string" },
        checks: {
          type: "object",
          additionalProperties: false,
          required: CHECK_NAMES,
          properties: Object.fromEntries(
            CHECK_NAMES.map((name) => [name, { type: "string", enum: ["pass", "fail", "uncertain"] }])
          )
        }
      }
    }
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_schema", json_schema: schema },
      messages: [
        {
          role: "system",
          content:
            "You moderate proposed WPCNA Community Postings. Return only JSON matching the schema. Be conservative: uncertain, political, accusatory, urgent, fundraising, commercial, or unclear-affiliation submissions must be needs_review unless clearly disallowed. Approve only clearly local, civic, educational, volunteer, neighborhood, school, public notice, cleanup, block party, meeting, newsletter, or public-interest submissions. Reject obvious spam, scams, classifieds, private services, commercial promotions, unrelated material, adult content, threats, or harassment. Do not decide publication; this is advisory moderation."
        },
        {
          role: "user",
          content: JSON.stringify({
            submission,
            mechanicalChecks: mechanicalChecks.results
          })
        }
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI moderation failed with ${response.status}: ${detail.slice(0, 300)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  return normalizeModeration(JSON.parse(content));
}

function subjectForModeration(moderation) {
  if (moderation.systemFallback) {
    return "[SYSTEM FALLBACK] Community Posting Submission";
  }

  if (moderation.status === "approved") {
    return "[APPROVED - ADVISORY] Community Posting Submission";
  }

  if (moderation.status === "rejected") {
    return "[REJECTED - ADVISORY] Community Posting Submission";
  }

  return "[NEEDS REVIEW] Community Posting Submission";
}

function checklistSummary(checks = {}) {
  return CHECK_NAMES.map((name) => `${name}: ${(checks[name] || "uncertain").toUpperCase()}`).join("\n");
}

function field(label, value) {
  const text = Array.isArray(value)
    ? value.map((item) => safeEmailText(item, 160)).filter(Boolean).join(", ")
    : safeEmailText(value, 1200);

  return `${label}: ${text || "Not provided"}`;
}

function formatAuditEmail({ id, submission, mechanicalChecks, moderation, timestamp }) {
  return [
    "WPCNA COMMUNITY POSTING INTAKE",
    field("Moderation ID", id),
    field("Timestamp", timestamp),
    "",
    "STRUCTURED SUBMISSION",
    field("Posting/Event Title", submission.title),
    field("Category", submission.category),
    field("Posting Type", submission.postingType),
    field("Event Date", submission.eventDate),
    field("Event Time", submission.eventTime),
    field("Location", submission.location),
    field("Intended Audience", submission.intendedAudience),
    field("White Plains Affiliation", submission.whitePlainsAffiliation),
    field("Organization/Group", submission.organizationName),
    field("Contact Name", submission.contactName),
    field("Contact Email", submission.contactEmail),
    field("Fundraising", submission.fundraising),
    field("Links Included", submission.linksIncluded),
    field("Guidelines Confirmed", submission.guidelinesConfirmed),
    field("Source Page", submission.pageSource),
    "",
    "MECHANICAL CHECKS",
    mechanicalSummary(mechanicalChecks),
    "",
    "GPT-4o ADVISORY DECISION",
    field("Status", moderation.status),
    field("Confidence", moderation.confidence),
    field("Reason", moderation.reason),
    field("Submitter-facing message", moderation.publicMessage),
    "",
    "CHECKLIST",
    checklistSummary(moderation.checks),
    "",
    "ORIGINAL SUBMISSION",
    safeEmailText(submission.description, MAX.description),
    "",
    "TECHNICAL FOOTER",
    "AI assisted this advisory classification.",
    "No public posting was created automatically.",
    "No API keys or secrets are included."
  ].join("\n");
}

async function sendAuditEmail({ subject, text, replyTo }) {
  const recipients = parseRecipients(process.env.AUDIT_EMAIL_RECIPIENTS || process.env.POSTING_RECIPIENT_EMAILS);
  const from = process.env.EMAIL_FROM || "WPCNA <onboarding@resend.dev>";

  if (!process.env.EMAIL_API_KEY) {
    throw new Error("EMAIL_API_KEY is not configured.");
  }

  if (!recipients.length) {
    throw new Error("AUDIT_EMAIL_RECIPIENTS is not configured.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.EMAIL_API_KEY}`
    },
    body: JSON.stringify({
      from,
      to: recipients,
      subject,
      text,
      reply_to: replyTo && isEmail(replyTo) ? [replyTo] : undefined
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Audit email failed with ${response.status}: ${detail.slice(0, 300)}`);
  }
}

async function writeReviewLog(record) {
  const logLine = JSON.stringify(record) + "\n";
  const logPath = path.join(os.tmpdir(), "wpcna-posting-moderation.ndjson");
  await fs.appendFile(logPath, logLine, "utf8");
  console.info("wpcna-posting-moderation", JSON.stringify({
    id: record.id,
    status: record.moderation.status,
    confidence: record.moderation.confidence,
    systemFallback: Boolean(record.moderation.systemFallback)
  }));
}

function allowedOrigin(origin = "") {
  if (!origin) return "*";
  if (origin === "https://wp-cna.github.io") return origin;
  if (/^https:\/\/wp-cna\.github\.io$/.test(origin)) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return origin;
  return "";
}

function setCors(req, res) {
  const origin = allowedOrigin(req.headers.origin);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readRequestBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return Object.fromEntries(new URLSearchParams(req.body).entries());
    }
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const origin = req.headers.origin || "";
  if (!allowedOrigin(origin)) {
    sendJson(res, 403, { ok: false, error: "This submission source is not allowed." });
    return;
  }

  let body;
  try {
    body = await readRequestBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: "Invalid submission." });
    return;
  }

  const submission = normalizeSubmission(body);
  if (submission.honeypot) {
    sendJson(res, 200, { ok: true, message: SUCCESS_MESSAGE });
    return;
  }

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const mechanicalChecks = runMechanicalChecks(submission);
  if (mechanicalChecks.hardFailures.length) {
    const moderation = {
      ...defaultModeration(
        "needs_review",
        `Mechanical validation failed: ${mechanicalChecks.hardFailures.join(", ")}`
      ),
      systemFallback: true
    };
    const auditBody = formatAuditEmail({
      id,
      submission,
      mechanicalChecks,
      moderation,
      timestamp
    });

    try {
      await writeReviewLog({
        id,
        timestamp,
        submission,
        mechanicalChecks,
        moderation
      });

      await sendAuditEmail({
        subject: "[SYSTEM FALLBACK] Community Posting Submission",
        text: auditBody,
        replyTo: submission.contactEmail
      });
    } catch (error) {
      console.error("Posting validation audit failed:", error);
    }

    sendJson(res, 422, {
      ok: false,
      error: "Please complete the required fields with enough detail for WPCNA to review."
    });
    return;
  }

  let moderation;

  try {
    moderation = await runOpenAiModeration(submission, mechanicalChecks);
  } catch (error) {
    console.error("OpenAI moderation fallback:", error);
    moderation = {
      ...defaultModeration("needs_review", `System fallback: ${error.message}`),
      systemFallback: true
    };
  }

  const auditSubject = subjectForModeration(moderation);
  const auditBody = formatAuditEmail({
    id,
    submission,
    mechanicalChecks,
    moderation,
    timestamp
  });

  try {
    await writeReviewLog({
      id,
      timestamp,
      submission,
      mechanicalChecks,
      moderation
    });

    await sendAuditEmail({
      subject: auditSubject,
      text: auditBody,
      replyTo: submission.contactEmail
    });
  } catch (error) {
    console.error("Posting moderation notification failed:", error);
    sendJson(res, 502, {
      ok: false,
      error: "The submission could not be sent for review right now. Please try again later."
    });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    message: SUCCESS_MESSAGE,
    moderationId: id
  });
};

module.exports._internals = {
  normalizeSubmission,
  runMechanicalChecks,
  normalizeModeration,
  formatAuditEmail
};
