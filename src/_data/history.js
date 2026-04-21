const neighborhoodStore = require("./neighborhoodStore");
const eventStore = require("./eventStore");

const FEATURED_NEIGHBORHOOD_SLUGS = [
  "battle-hill",
  "good-counsel",
  "kirkbride-asylum",
  "burke-institute",
  "bryant-gardens",
  "gedney-farms"
];

const HISTORY_EVENT_PATTERN = /\b(?:history|historic|genealogy|revolutionary|battle|heritage|patriot|loyalist|preservation)\b/i;

function pickFeaturedNeighborhoods() {
  return FEATURED_NEIGHBORHOOD_SLUGS
    .map((slug) => neighborhoodStore.bySlug[slug])
    .filter(Boolean);
}

function isHistoryEvent(event) {
  const haystack = [
    event.title,
    event.shortSummary,
    event.fullDescription,
    event.category,
    (event.tags || []).join(" ")
  ].join(" ");

  return HISTORY_EVENT_PATTERN.test(haystack);
}

module.exports = {
  overview: [
    "The current site is mainly a civic guide, not a full local history archive, but some neighborhood pages already point to important historical threads in White Plains.",
    "Those threads include the Battle of White Plains, long-standing institutions and campuses, and neighborhoods with roots in the 1700s, early 1900s, and 1950s.",
    "The events calendar also picks up history and genealogy programs when current partner sources publish them."
  ],
  featuredNeighborhoods: pickFeaturedNeighborhoods(),
  historyEvents: eventStore.upcoming.filter(isHistoryEvent).slice(0, 6),
  askPrompts: [
    "What history does the site cover about White Plains?",
    "Tell me about Battle Hill.",
    "Which White Plains neighborhoods on the site have historic context?",
    "Are there any history or genealogy events coming up?"
  ]
};
