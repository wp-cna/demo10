import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import * as cheerio from "cheerio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const AGENDAS_PATH = path.join(ROOT, "src", "_data", "agendas.json");

const CURRENT_URL = "https://wp-cna.org/agendas";
const ARCHIVE_URL = "https://wp-cna.org/archived-agendas";
const USER_AGENT =
  "Mozilla/5.0 (compatible; WPCNAAgendaUpdater/1.0; +https://wp-cna.github.io/demo3/)";
const DEFAULT_INTRO =
  "WPCNA meets monthly (typically the second Tuesday at 7:00 p.m.). Meeting minutes from each session are posted here as they become available.";

const MONTH_INDEX = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const existing = await readJson(AGENDAS_PATH, {
    intro: DEFAULT_INTRO,
    current: [],
    archive: []
  });

  const existingByPdf = new Map(
    [...(existing.current || []), ...(existing.archive || [])]
      .filter((item) => item?.pdf)
      .map((item) => [normalizeUrl(item.pdf), item])
  );

  let currentItems = existing.current || [];

  try {
    currentItems = await fetchAgendaPage(CURRENT_URL);
    console.log(`Fetched ${currentItems.length} current agenda items.`);
  } catch (error) {
    if (!currentItems.length) {
      throw error;
    }

    console.warn(`Could not refresh current agenda items: ${error.message}`);
  }

  let archiveItems = existing.archive || [];

  try {
    archiveItems = await fetchAgendaPage(ARCHIVE_URL);
    console.log(`Fetched ${archiveItems.length} archived agenda items.`);
  } catch (error) {
    if (!archiveItems.length) {
      console.warn(`Could not refresh archive agenda items: ${error.message}`);
    } else {
      console.warn(`Could not refresh archive agenda items; keeping existing archive: ${error.message}`);
    }
  }

  const normalizedCurrent = dedupeItems(currentItems.map((item) => mergeExisting(item, existingByPdf))).sort(
    compareAgendaItems
  );

  const currentKeys = new Set(normalizedCurrent.map((item) => agendaKey(item)));
  const normalizedArchive = dedupeItems(
    [
      ...archiveItems,
      ...(existing.current || []),
      ...(existing.archive || [])
    ]
      .map((item) => mergeExisting(item, existingByPdf))
      .filter((item) => !currentKeys.has(agendaKey(item)))
  ).sort(compareAgendaItems);

  const output = {
    intro: existing.intro || DEFAULT_INTRO,
    current: normalizedCurrent,
    archive: normalizedArchive
  };

  await fs.writeFile(AGENDAS_PATH, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(
    `Wrote ${output.current.length} current and ${output.archive.length} archived agenda items to ${path.relative(ROOT, AGENDAS_PATH)}.`
  );
}

async function fetchAgendaPage(url) {
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const headings = $('[data-aid="PDF_SECTION_TITLE_RENDERED"]').toArray();
  const items = headings
    .map((heading) => parseAgendaItem($, heading, url))
    .filter(Boolean);

  if (!items.length) {
    throw new Error(`No agenda items parsed from ${url}`);
  }

  return items;
}

function parseAgendaItem($, heading, pageUrl) {
  const section = $(heading).closest("section");
  const sectionTitle = cleanText($(heading).text());
  const inlineTitle = cleanText(section.find('[data-aid="PDF_HEADING_RENDERED"]').first().text());
  const rawTitle = inlineTitle && !/^pdf viewer$/i.test(inlineTitle) ? inlineTitle : sectionTitle;
  const pdfHref =
    section.find('[data-aid="PDF_DOWNLOAD_LINK_RENDERED"]').first().attr("href") ||
    section.find('[data-aid="PDF_LINK_OVERLAY"]').first().attr("href");

  if (!pdfHref) {
    return null;
  }

  const pdf = absoluteUrl(pdfHref, pageUrl);
  const zoom = section
    .find('a[href*="zoom.us"], a[href*="drive.google.com"]')
    .toArray()
    .map((link) => absoluteUrl($(link).attr("href"), pageUrl))
    .find((href) => normalizeUrl(href) !== normalizeUrl(pdf));

  const dateParts = extractAgendaDate(rawTitle, pdf);

  if (!dateParts) {
    console.warn(`Skipping agenda item with unparseable date: ${rawTitle}`);
    return null;
  }

  const label = formatDateLabel(dateParts);
  const title = formatAgendaTitle({
    rawTitle,
    label,
    pdf
  });

  return {
    date: toIsoDate(dateParts),
    label,
    title,
    pdf,
    ...(zoom ? { zoom } : {})
  };
}

function extractAgendaDate(...sources) {
  for (const source of sources) {
    const text = cleanText(decodeURIComponent(String(source || "")));

    if (!text) continue;

    const monthMatch = text.match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\b/i
    );

    if (monthMatch) {
      const [, monthName, day, year] = monthMatch;

      return {
        year: Number(year),
        month: MONTH_INDEX[monthName.toLowerCase()],
        day: Number(day)
      };
    }

    const slashOrDashMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);

    if (slashOrDashMatch) {
      const [, month, day, yearText] = slashOrDashMatch;

      return {
        year: normalizeYear(yearText),
        month: Number(month),
        day: Number(day)
      };
    }

    const compactMatch = text.match(/\b(\d{2})(\d{2})(\d{2})\b/);

    if (compactMatch) {
      const [, month, day, yearText] = compactMatch;

      return {
        year: normalizeYear(yearText),
        month: Number(month),
        day: Number(day)
      };
    }
  }

  return null;
}

function normalizeYear(yearText) {
  const year = Number(yearText);
  return yearText.length === 2 ? 2000 + year : year;
}

function formatAgendaTitle({ rawTitle, label, pdf }) {
  const normalized = `${rawTitle} ${decodeURIComponent(pdf)}`.toLowerCase();
  const isAgenda = normalized.includes("agenda");
  const prefix = normalized.includes("wpcna") ? "WPCNA" : "CNA";

  return `${prefix} Meeting ${isAgenda ? "Agenda" : "Minutes"} — ${label}`;
}

function formatDateLabel({ year, month, day }) {
  const date = new Date(Date.UTC(year, month - 1, day));

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function toIsoDate({ year, month, day }) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function mergeExisting(item, existingByPdf) {
  const existing = existingByPdf.get(normalizeUrl(item.pdf));

  if (!existing) {
    return item;
  }

  return {
    ...item,
    title: existing.title || item.title,
    zoom: item.zoom || existing.zoom,
    note: existing.note || item.note
  };
}

function dedupeItems(items) {
  const seen = new Set();

  return items.filter((item) => {
    const key = agendaKey(item);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function agendaKey(item) {
  return normalizeUrl(item.pdf) || `${item.date}:${cleanText(item.title).toLowerCase()}`;
}

function compareAgendaItems(a, b) {
  return b.date.localeCompare(a.date);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value, baseUrl) {
  if (!value) return "";
  if (value.startsWith("//")) return `https:${value}`;
  return new URL(value, baseUrl).toString();
}

function normalizeUrl(value) {
  return String(value || "")
    .replace(/^https?:/, "https:")
    .trim();
}
