// Domain synonym / acronym expansion applied at query time to improve lexical
// recall (PLAN.md 6.1). Each group lists interchangeable surface forms; if the
// query mentions any member, the others are OR'd into the full-text query so a
// search for "FoP" also matches "field of play" and vice versa.
//
// Kept deliberately small and hand-curated — this is recall help, not a thesaurus.
const GROUPS: string[][] = [
  ["field of play", "FoP", "playing field", "pitch"],
  // 2026 renamed the security/operations "Control Room" to "Venue Operation Centre".
  ["control room", "venue operation centre", "venue operation center"],
  ["run-off", "run off", "clear space", "safety margin"],
  ["technical area", "dugout", "team bench"],
  ["dressing room", "changing room", "locker room"],
  ["media tribune", "press box", "press tribune"],
  ["VIP", "hospitality", "vip box"],
  ["floodlight", "floodlighting", "lux", "illuminance", "lighting"],
  ["spectator", "spectators", "crowd", "audience"],
  ["turnstile", "turnstiles", "entry gate"],
  ["accreditation", "accredited", "credential"],
  ["FIFA", "Federation Internationale de Football Association"],
  ["UEFA", "Union of European Football Associations"],
  ["AFC", "Asian Football Confederation"],
];

// Longest surface forms first so multi-word phrases match before their sub-words.
const ENTRIES = GROUPS.flatMap((g) =>
  g.map((form) => ({ form, group: g })),
).sort((a, b) => b.form.length - a.form.length);

export type Expansion = { matched: string; added: string[] };

// Given a natural-language query, return a full-text query string that ORs in
// synonyms for any recognised term, plus the list of expansions applied (for UI).
export function expandLexicalQuery(query: string): { lexQuery: string; expansions: Expansion[] } {
  const lower = query.toLowerCase();
  const expansions: Expansion[] = [];
  const added = new Set<string>();

  for (const { form, group } of ENTRIES) {
    if (!lower.includes(form.toLowerCase())) continue;
    const extras = group.filter(
      (o) => o.toLowerCase() !== form.toLowerCase() && !lower.includes(o.toLowerCase()) && !added.has(o.toLowerCase()),
    );
    if (extras.length === 0) continue;
    extras.forEach((e) => added.add(e.toLowerCase()));
    expansions.push({ matched: form, added: extras });
  }

  if (expansions.length === 0) return { lexQuery: query, expansions };

  // websearch_to_tsquery treats spaces as AND and understands the OR keyword.
  // Quote multi-word forms so they stay phrases.
  const orTerms = expansions.flatMap((e) => e.added).map((t) => (t.includes(" ") ? `"${t}"` : t));
  const lexQuery = `${query} OR ${orTerms.join(" OR ")}`;
  return { lexQuery, expansions };
}
