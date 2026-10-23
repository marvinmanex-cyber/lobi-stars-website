// SEO Scanner: every kind of issue, in one place. Each has a category, a
// severity, what it means and why it matters for Google, a rough impact, and
// which of the three actions it offers:
//   ai:   "AI Fix" – a data change (titles, descriptions, alt text, structured
//         data, redirects, links in news, sitemap resubmission, robots.txt) previewed
//         and applied only after a Super Admin approves; or for code-level issues a
//         ready-to-paste VS Code instruction (code: true; nothing on the server changes)
//   auto: the fix is safe and reversible enough to run by itself (Automation Rules)
//   self: always: a step-by-step "Fix it myself" guide (seoGuides.js)
// Lobi Stars has no academy or women's team: nothing here mentions them.

export const CATEGORIES = [
  { key: 'rankings', label: 'Rankings & visibility', icon: '📈' },
  { key: 'indexing', label: 'Indexing', icon: '🗂️' },
  { key: 'technical', label: 'Technical', icon: '🛠️' },
  { key: 'speed', label: 'Speed', icon: '⚡' },
  { key: 'content', label: 'Content', icon: '📝' },
  { key: 'offsite', label: 'Off-site & local', icon: '📍' },
];
export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const SEVERITY_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const W = { critical: 12, high: 5, medium: 2, low: 0.5 };

export const ISSUES = {
  // ── A. Rankings and visibility (Search Console; optional rank tracker) ──
  rank_drop: { category: 'rankings', severity: 'high', name: 'A target keyword dropped 3+ places', why: 'Fewer fans find the page when it slips down Google.', impact: 7, ai: 'title_description' },
  clicks_drop: { category: 'rankings', severity: 'medium', name: 'A page is losing Google clicks', why: 'Fewer visits from Google to this page than in the previous weeks.', impact: 5, ai: 'title_description' },
  low_ctr: { category: 'rankings', severity: 'medium', name: 'Seen often on Google but rarely clicked', why: 'A clearer title and description get more of the people who see it to click.', impact: 7, ai: 'title_description' },
  almost_top: { category: 'rankings', severity: 'medium', name: 'Close to the top of Google (positions 4–15)', why: 'A small improvement here moves the page onto page one or into the top three, where most clicks go.', impact: 8, ai: 'title_description' },
  cannibal: { category: 'rankings', severity: 'medium', name: 'The wrong page ranks for a target keyword', why: 'Google shows a different page than the one meant for this search, so the best page loses out.', impact: 5, ai: 'internal_links' },
  // ── B. Indexing (Search Console) ──
  not_indexed: { category: 'indexing', severity: 'high', name: 'An important page is not on Google', why: 'A page that is not indexed can never appear in search results.', impact: 8, ai: 'sitemap' },
  sitemap_errors: { category: 'indexing', severity: 'high', name: 'Google reports sitemap errors', why: 'The sitemap tells Google which pages exist; errors mean pages may be missed.', impact: 6, ai: 'sitemap', auto: true },
  sitemap_unread: { category: 'indexing', severity: 'medium', name: 'Google has not read the sitemap recently', why: 'New pages are found more slowly.', impact: 3, ai: 'sitemap', auto: true },
  deindexed: { category: 'indexing', severity: 'critical', name: 'The website is disappearing from Google', why: 'Search traffic has collapsed: often a blocking rule, a site error, a manual action or a security problem.', impact: 10 },
  // ── C. Technical (our own crawler) ──
  http_error: { category: 'technical', severity: 'high', name: 'A page answers with an error', why: 'Error pages drop out of Google and frustrate fans.', impact: 7, ai: 'redirect', code: 'maybe' },
  redirect_chain: { category: 'technical', severity: 'medium', name: 'Redirect chain', why: 'Several redirects in a row slow pages down and waste Google’s visits.', impact: 3, ai: 'vscode', code: true },
  redirect_loop: { category: 'technical', severity: 'high', name: 'Redirect loop', why: 'The page never loads, for fans or for Google.', impact: 7, ai: 'vscode', code: true },
  broken_link: { category: 'technical', severity: 'high', name: 'Broken internal link', why: 'Links to missing pages are dead ends for fans and for Google.', impact: 5, ai: 'redirect', auto: true },
  broken_external: { category: 'technical', severity: 'low', name: 'Broken link to another website', why: 'Dead links make the page look neglected.', impact: 2, ai: 'fix_link' },
  title_missing: { category: 'technical', severity: 'high', name: 'Page title missing', why: 'Google uses the title as the headline in search results.', impact: 8, ai: 'title_description' },
  title_duplicate: { category: 'technical', severity: 'medium', name: 'Same title as other pages', why: 'Google cannot tell the pages apart and may show the wrong one.', impact: 5, ai: 'title_description' },
  title_length: { category: 'technical', severity: 'low', name: 'Title too long or too short', why: 'Titles over about 60 characters are cut off; very short ones say too little (aim 30–60).', impact: 3, ai: 'title_description' },
  desc_missing: { category: 'technical', severity: 'medium', name: 'Meta description missing', why: 'Without one Google picks random text from the page for the search snippet.', impact: 5, ai: 'title_description', auto: true },
  desc_duplicate: { category: 'technical', severity: 'low', name: 'Same meta description as other pages', why: 'Each page should explain what is special about it.', impact: 3, ai: 'title_description', auto: true },
  desc_length: { category: 'technical', severity: 'low', name: 'Meta description too long or too short', why: 'Aim for 70–160 characters so the whole description shows.', impact: 2, ai: 'title_description' },
  h1_missing: { category: 'technical', severity: 'medium', name: 'No main heading (H1)', why: 'The H1 tells Google and screen readers what the page is about.', impact: 4, ai: 'vscode', code: true },
  h1_multiple: { category: 'technical', severity: 'low', name: 'More than one main heading (H1)', why: 'One clear main heading per page is easiest for Google to understand.', impact: 2, ai: 'vscode', code: true },
  heading_order: { category: 'technical', severity: 'low', name: 'Headings skip a level', why: 'Headings in order (H1, H2, H3) help Google and screen-reader users follow the page.', impact: 1, ai: 'vscode', code: true },
  img_alt: { category: 'technical', severity: 'medium', name: 'Images without alt text', why: 'Alt text lets Google Images understand the photo and helps blind fans.', impact: 4, ai: 'alt_text', auto: true },
  img_large: { category: 'technical', severity: 'medium', name: 'Very large image', why: 'Big images slow the page on mobile data, which Google measures.', impact: 4, ai: 'vscode', code: true },
  img_format: { category: 'technical', severity: 'low', name: 'Image not in WebP', why: 'WebP photos are much smaller, so pages load faster.', impact: 2, ai: 'vscode', code: true },
  img_size_attr: { category: 'technical', severity: 'low', name: 'Image without width and height', why: 'Without them the page jumps while loading (layout shift, a Core Web Vital).', impact: 2, ai: 'vscode', code: true },
  canonical_missing: { category: 'technical', severity: 'medium', name: 'Canonical tag missing', why: 'The canonical tag tells Google the main address of a page and avoids duplicates.', impact: 3, ai: 'vscode', code: true },
  canonical_wrong: { category: 'technical', severity: 'high', name: 'Canonical points to another page', why: 'Google may index the other page instead of this one.', impact: 6, ai: 'vscode', code: true },
  noindex_public: { category: 'technical', severity: 'critical', name: 'A public page tells Google not to index it', why: 'A "noindex" page never appears in Google.', impact: 10, ai: 'vscode', code: true },
  private_indexable: { category: 'technical', severity: 'critical', name: 'A private page could appear on Google', why: 'Admin and portal pages must always tell search engines to stay away.', impact: 10, ai: 'vscode', code: true },
  schema_missing: { category: 'technical', severity: 'medium', name: 'Structured data missing', why: 'Structured data (club, match, article, player) helps Google show richer results.', impact: 4, ai: 'schema', auto: true },
  schema_invalid: { category: 'technical', severity: 'high', name: 'Structured data has errors', why: 'Google ignores structured data with errors.', impact: 5, ai: 'schema', auto: true },
  sitemap_missing_page: { category: 'technical', severity: 'medium', name: 'Public page missing from sitemap.xml', why: 'Pages in the sitemap are found and indexed faster.', impact: 3, ai: 'sitemap', auto: true },
  sitemap_bad_entry: { category: 'technical', severity: 'medium', name: 'sitemap.xml lists a page it should not', why: 'Broken, redirecting or noindex pages in the sitemap waste Google’s visits.', impact: 3, ai: 'sitemap', auto: true },
  robots_blocking: { category: 'technical', severity: 'critical', name: 'robots.txt blocks Google from the website', why: 'Google cannot read any page, so the site falls out of search.', impact: 10, ai: 'robots' },
  robots_problem: { category: 'technical', severity: 'medium', name: 'robots.txt needs attention', why: 'robots.txt should point to the sitemap and keep only private areas out.', impact: 3, ai: 'robots' },
  https_problem: { category: 'technical', severity: 'high', name: 'Insecure (http://) content on a page', why: 'Browsers warn about or block insecure content; Google prefers secure pages.', impact: 5, ai: 'vscode', code: true },
  viewport_missing: { category: 'technical', severity: 'high', name: 'No mobile viewport', why: 'Without it the page is not mobile-friendly, and Google ranks the mobile version.', impact: 6, ai: 'vscode', code: true },
  hreflang_invalid: { category: 'technical', severity: 'low', name: 'Language tags (hreflang) have mistakes', why: 'The site is in English only, so language tags are not needed; wrong ones confuse Google.', impact: 1, ai: 'vscode', code: true },
  social_tags: { category: 'technical', severity: 'low', name: 'Sharing tags (Open Graph / X) missing', why: 'Links shared on WhatsApp, Facebook and X look plain without them.', impact: 2, ai: 'vscode', code: true },
  // ── D. Speed (PageSpeed Insights) ──
  speed_poor: { category: 'speed', severity: 'high', name: 'Slow on mobile', why: 'Most fans use mobile data; Google uses page experience as a ranking signal.', impact: 6, ai: 'vscode', code: true },
  speed_fair: { category: 'speed', severity: 'medium', name: 'Speed could be better', why: 'Faster pages keep more visitors and do better on Google.', impact: 3, ai: 'vscode', code: true },
  cwv_poor: { category: 'speed', severity: 'high', name: 'Core Web Vitals poor', why: 'Google measures loading (LCP), responsiveness (INP) and stability (CLS).', impact: 6, ai: 'vscode', code: true },
  // ── E. Content ──
  thin_page: { category: 'content', severity: 'medium', name: 'Very little text on the page', why: 'Pages with almost no text rarely rank: Google needs something to understand.', impact: 4, ai: 'draft_text' },
  stale_fixtures: { category: 'content', severity: 'high', name: 'Fixtures or table look out of date', why: 'Old "upcoming" matches tell fans and Google the site is not kept up to date.', impact: 6, ai: 'mark_staff' },
  keyword_missing: { category: 'content', severity: 'medium', name: 'Target keyword missing from its page', why: 'The page meant for a search phrase should use it naturally in the title, main heading and first paragraph.', impact: 5, ai: 'title_description' },
  orphan_page: { category: 'content', severity: 'medium', name: 'No other page links here', why: 'Google finds and values pages through links from other pages.', impact: 4, ai: 'internal_links' },
  news_player_links: { category: 'content', severity: 'low', name: 'News story does not link to the players it mentions', why: 'Links between stories and player pages help fans and Google move around the site.', impact: 3, ai: 'internal_links' },
  duplicate_content: { category: 'content', severity: 'medium', name: 'Near-duplicate pages', why: 'Google picks one and may ignore the other.', impact: 4 },
  // ── F. Off-site and local (guidance) ──
  gbp_checklist: { category: 'offsite', severity: 'low', name: 'Google Business Profile checklist', why: 'A complete profile for the club and McCarthy Stadium shows on Google Maps and in local searches.', impact: 4 },
  nap_inconsistent: { category: 'offsite', severity: 'medium', name: 'Club name, address or phone differ across the site', why: 'Google trusts consistent contact details.', impact: 3 },
  org_social: { category: 'offsite', severity: 'low', name: 'Social profiles not linked in the club’s structured data', why: 'Linking them helps Google connect the club’s social profiles to the website.', impact: 2, ai: 'schema', auto: true },
};
export const info = type => ISSUES[type] || { category: 'technical', severity: 'low', name: type, why: '', impact: 1 };

/** The three actions for an issue type (what the dashboard shows). */
export function actionsFor(type) {
  const i = info(type);
  return {
    ai: !!i.ai,                                  // AI Fix (data change, or the VS Code instruction for code-level issues)
    code: i.code === true || i.ai === 'vscode',  // the AI Fix is a VS Code instruction (no change on the server)
    automate: !!i.ai && i.ai !== 'vscode',       // Set up AI to fix this next time
    autoAllowed: !!i.auto,                       // "AI fixes automatically" allowed (safe, reversible)
    self: true,                                  // Fix it myself (always)
  };
}
/** Types that may be fixed automatically, and never these (whatever a rule says). */
export const NEVER_AUTO = ['title_missing', 'title_duplicate', 'title_length', 'low_ctr', 'almost_top', 'rank_drop', 'clicks_drop', 'keyword_missing', 'robots_blocking', 'robots_problem', 'thin_page', 'draft_text'];
export const autoAllowed = type => !!info(type).auto && !NEVER_AUTO.includes(type);

/** Health score 0–100 from the open issues (each type counts less the more often it repeats). */
export function healthScore(issues) {
  const byType = new Map();
  for (const i of issues) byType.set(i.type, { sev: i.severity, n: (byType.get(i.type)?.n || 0) + 1 });
  let penalty = 0;
  // A problem repeated on many pages counts more, but at most three times as much.
  for (const { sev, n } of byType.values()) penalty += (W[sev] || 0) * Math.min(3, 1 + Math.log2(n) / 2);
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}
export const countBySeverity = issues => Object.fromEntries(SEVERITIES.map(s => [s, issues.filter(i => i.severity === s).length]));
