# Ask White Plains

Ask White Plains is a grounded civic assistant for the WPCNA site.

It is split into two parts:

- The static Eleventy frontend at `/ask/`
- A separate Cloudflare Worker API that handles retrieval and the model call

## What it answers from

The assistant is intentionally narrow. It answers from approved WPCNA and site content such as:

- homepage and about-page content
- White Plains history already represented on the site
- agendas and meeting materials
- handbook / workshop content
- events pages
- neighborhoods pages
- community posting guidance
- approved community-resource links already represented on the site

If the current WPCNA sources do not support an answer, it should say so.

## Local site build

Install dependencies and run the site:

```bash
npm install
npm run start
```

Build the static site and regenerate the AI index:

```bash
npm run build
```

That build now does two things:

1. renders the Eleventy site into `_site/`
2. regenerates the retrieval index files:
   - `ai/content-index.json`
   - `worker/src/content-index.js`

## Backend setup

The backend lives in `worker/` and is deployed separately from GitHub Pages.

Install the worker dependencies:

```bash
cd worker
npm install
```

For local worker development, create `worker/.dev.vars`:

```env
OPENAI_API_KEY=your_key_here
```

Optional local overrides:

```env
OPENAI_MODEL=gpt-5-mini
ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080,https://never-nude.github.io
MAX_SOURCES=6
```

Run the worker locally:

```bash
cd worker
npm run dev
```

## Backend deployment

Deploy the worker with Wrangler:

```bash
cd worker
npx wrangler secret put OPENAI_API_KEY
npm run deploy
```

The worker uses:

- `OPENAI_API_KEY` for the model provider key
- `OPENAI_MODEL` for the model name, defaulting to `gpt-5-mini`
- `ALLOWED_ORIGINS` for CORS
- `MAX_SOURCES` for retrieval depth

The code is organized so a different provider can be swapped in later, but the first implementation uses OpenAI's Responses API.

## Frontend configuration

The static site needs the deployed worker URL at build time.

Set this environment variable before building the site:

```env
ASK_WHITE_PLAINS_API_URL=https://your-worker-subdomain.workers.dev
```

For GitHub Pages, the deploy workflow reads:

```text
vars.ASK_WHITE_PLAINS_API_URL
```

Set that as a GitHub repository variable so the built `/ask/` page points to the deployed backend.

## Retrieval/index updates

Whenever content changes, regenerate the index:

```bash
npm run build
```

That is enough for local work. The scheduled event-update workflow also regenerates and commits the AI index whenever the event feed changes.

## Testing the feature

Recommended smoke test:

1. Build the site with `ASK_WHITE_PLAINS_API_URL` set.
2. Run the worker locally or deploy it.
3. Open `/ask/`.
4. Try:
   - `What does WPCNA do?`
   - `What history does the site cover about White Plains?`
   - `How do I submit a community posting?`
   - `Where can I find agendas?`
   - `Tell me about Fisher Hill.`
   - `How do I learn about forming a neighborhood association?`
5. Confirm the page shows:
   - loading state
   - concise answer
   - source links
   - graceful fallback when the sources do not support the question

## Security notes

- Model keys stay in worker secrets, never in client-side code.
- The frontend only receives the public worker URL.
- The worker uses retrieved site excerpts and instructs the model to answer only from those excerpts.
- The OpenAI request sets `store: false` so end-user questions are not stored by default.
