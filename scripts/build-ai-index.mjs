import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const cheerio = require("cheerio");
const site = require("../src/_data/site.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const siteDir = path.join(repoRoot, "_site");
const jsonOutputPath = path.join(repoRoot, "ai", "content-index.json");
const workerOutputPath = path.join(repoRoot, "worker", "src", "content-index.js");
const MAX_TEXT_LENGTH = 2800;
const SKIP_URLS = new Set([
  "/404/",
  "/ask/"
]);

function normalizeText(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function trimToBoundary(value, maxLength = MAX_TEXT_LENGTH) {
  if (value.length <= maxLength) {
    return value;
  }

  const slice = value.slice(0, maxLength);
  const boundary = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("\n")
  );

  return (boundary > 250 ? slice.slice(0, boundary + 1) : slice).trim();
}

function summarizeText(value = "") {
  const text = normalizeText(value);

  if (!text) {
    return "";
  }

  if (text.length <= 220) {
    return text;
  }

  const truncated = text.slice(0, 220);
  const boundary = truncated.lastIndexOf(". ");

  return `${(boundary > 80 ? truncated.slice(0, boundary + 1) : truncated).trim()}...`;
}

function deriveUrl(filePath) {
  const relative = path.relative(siteDir, filePath).replaceAll(path.sep, "/");

  if (relative === "index.html") {
    return "/";
  }

  if (relative.endsWith("/index.html")) {
    return `/${relative.slice(0, -"index.html".length)}`;
  }

  if (relative.endsWith(".html")) {
    return `/${relative.slice(0, -".html".length)}/`;
  }

  return `/${relative}`;
}

function inferType(url) {
  if (url === "/") return "home";
  if (url === "/about/") return "wpcna";
  if (url === "/agendas/") return "agendas";
  if (url === "/history/") return "history";
  if (url === "/workshops/" || url === "/handbook/") return "handbook";
  if (url === "/events/") return "events";
  if (url.startsWith("/events/")) return "event";
  if (url === "/neighborhoods/") return "neighborhoods";
  if (url.startsWith("/neighborhoods/")) return "neighborhood";
  if (url === "/neighborhood-map/") return "map";
  if (url === "/posting/" || url === "/community-posting/") return "community-posting";
  return "page";
}

async function collectHtmlFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return collectHtmlFiles(fullPath);
      }

      return entry.isFile() && entry.name.endsWith(".html") ? [fullPath] : [];
    })
  );

  return files.flat();
}

function extractMainText($) {
  const main = $("main").first().clone();

  if (!main.length) {
    return "";
  }

  main.find("script, style, noscript").remove();

  const blocks = [];

  main.find("h1, h2, h3, p, li, dt, dd, address, figcaption").each((_, element) => {
    const text = normalizeText($(element).text());

    if (!text) {
      return;
    }

    if (blocks[blocks.length - 1] === text) {
      return;
    }

    blocks.push(text);
  });

  return trimToBoundary(blocks.join("\n\n"));
}

async function buildPageEntry(filePath) {
  const html = await fs.readFile(filePath, "utf8");
  const $ = cheerio.load(html);
  const url = deriveUrl(filePath);

  if (SKIP_URLS.has(url)) {
    return null;
  }

  const title = normalizeText($("title").first().text()).replace(/\s+-\s+WPCNA$/i, "");
  const metaDescription = normalizeText($('meta[name="description"]').attr("content") || "");
  const text = extractMainText($);

  if (!text) {
    return null;
  }

  const combinedText = trimToBoundary(
    [metaDescription, text]
      .filter(Boolean)
      .join("\n\n")
  );

  return {
    id: `page:${url}`,
    sourceId: `page:${url}`,
    title: title || url,
    url,
    type: inferType(url),
    excerpt: summarizeText(metaDescription || text),
    text: combinedText
  };
}

function buildCommunityEntries() {
  return (site.communityChannels || []).map((resource) => ({
    id: `resource:${resource.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    sourceId: `resource:${resource.url}`,
    title: resource.label,
    url: resource.url,
    type: "community-resource",
    excerpt: "Approved local civic resource linked from the WPCNA site.",
    text: `${resource.label}. Approved local civic resource linked from the WPCNA site for White Plains residents.`
  }));
}

async function main() {
  try {
    await fs.access(siteDir);
  } catch {
    throw new Error(`Missing built site at ${siteDir}. Run the Eleventy build before generating the AI index.`);
  }

  const htmlFiles = await collectHtmlFiles(siteDir);
  const pageEntries = (await Promise.all(htmlFiles.map(buildPageEntry))).filter(Boolean);
  const items = [...pageEntries, ...buildCommunityEntries()].sort((left, right) =>
    left.url.localeCompare(right.url)
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    itemCount: items.length,
    items
  };

  await fs.mkdir(path.dirname(jsonOutputPath), { recursive: true });
  await fs.mkdir(path.dirname(workerOutputPath), { recursive: true });

  await fs.writeFile(jsonOutputPath, `${JSON.stringify(payload, null, 2)}\n`);
  await fs.writeFile(workerOutputPath, `export default ${JSON.stringify(payload, null, 2)};\n`);

  console.log(`Wrote ${items.length} Ask White Plains index entries.`);
  console.log(`- ${jsonOutputPath}`);
  console.log(`- ${workerOutputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
