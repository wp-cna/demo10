# Community Posting Moderation Endpoint

This phase runs in advisory moderation mode. The Community Posting form sends structured intake data to a private serverless endpoint, which performs mechanical checks, asks GPT-4o for a conservative guideline review, sends an audit email, and records a short moderation log. It does not publish, approve, or reject public site content automatically.

## Runtime

The endpoint is `api/posting-review.js`, intended for Vercel serverless functions. The static site receives the deployed endpoint URL through the `POSTING_API_URL` build variable.

Required private environment variables:

- `OPENAI_API_KEY`: OpenAI API key used server-side only.
- `EMAIL_API_KEY`: Resend API key used server-side only.
- `EMAIL_FROM`: verified sender address for Resend.
- `AUDIT_EMAIL_RECIPIENTS`: comma-separated private audit recipients.

Optional:

- `POSTING_API_URL`: GitHub Pages build variable pointing to the deployed endpoint.

No API keys or recipient addresses should be placed in public HTML or frontend JavaScript.

## Flow

1. The resident submits the Community Posting intake form.
2. The frontend sends structured JSON to `POSTING_API_URL`.
3. The endpoint validates required fields, email format, description length, link count, repeated text, spam phrases, all-caps titles, and gibberish-like input.
4. If required mechanical checks fail, the endpoint logs and attempts an audit email without calling GPT-4o.
5. GPT-4o reviews valid submissions with temperature `0` and returns strict JSON.
6. The endpoint emails a scannable audit report with the original submission, mechanical checks, GPT decision, confidence, reason, and checklist.
7. The endpoint writes an advisory log entry to the function runtime temp directory.
8. The browser only receives a neutral confirmation message.

## Test Curl

Replace the URL with the deployed Vercel endpoint.

```bash
curl -X POST "https://YOUR-VERCEL-APP.vercel.app/api/posting-review" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Fisher Hill Block Party",
    "category": "Neighborhood Event",
    "postingType": "Event",
    "eventDate": "2026-05-25",
    "eventTime": "1:00 PM - 3:00 PM",
    "location": "Fisher Hill",
    "intendedAudience": ["Residents", "Families"],
    "whitePlainsAffiliation": "White Plains neighborhood association",
    "contactName": "Test Submitter",
    "contactEmail": "test@example.com",
    "organizationName": "Fisher Hill Association",
    "fundraising": "No",
    "linksIncluded": "No",
    "description": "A neighborhood block party for Fisher Hill residents with informal family activities and a chance to meet neighbors.",
    "guidelinesConfirmed": "yes",
    "pageSource": "/demo10/posting/"
  }'
```

Expected browser response:

```json
{
  "ok": true,
  "message": "Thank you. Your submission has been received and is being reviewed by WPCNA."
}
```

## Deployment Notes

For the GitHub Pages demo build, set:

- `SITE_BASE_URL=https://wp-cna.github.io`
- `SITE_PATH_PREFIX=/demo10`
- `CANONICAL_PATH_PREFIX=/demo10`
- repository variable `POSTING_API_URL` to the deployed Vercel function URL

This advisory phase intentionally leaves auto-publishing disabled.
