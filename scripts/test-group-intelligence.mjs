import {
  findGroupPosterMatches,
  formatGroupIntelligenceForPrompt,
  getGroupIntelligenceIndex,
  searchGroupIntelligence,
} from "../src/lib/kb/group-intelligence.js";

const queries = [
  "Any distressed property deals from the groups?",
  "Any cheap properties mentioned in the groups?",
  "Who posted property deals recently?",
  "Find rental bargains from PB",
  "Any below-market stuff?",
  "Any urgent sellers or discounted units?",
];

console.log("=== GROUP INTELLIGENCE TEST ===\n");

const index = getGroupIntelligenceIndex();
for (const doc of index) {
  console.log(`Indexed: ${doc.groupName}`);
  console.log(`  file: ${doc.file}`);
  console.log(`  actionable messages: ${doc.messageCount}\n`);
}

for (const query of queries) {
  console.log("=".repeat(72));
  console.log(`QUERY: ${query}`);
  const hits = searchGroupIntelligence(query, { maxResults: 3 });
  console.log(`Matches: ${hits.length}\n`);
  console.log(formatGroupIntelligenceForPrompt(hits));
  console.log("");
}

console.log("=".repeat(72));
console.log('POSTER LOOKUP: "Aishah"');
const poster = findGroupPosterMatches("Aishah", 2);
console.log(formatGroupIntelligenceForPrompt(poster));
console.log("");

console.log("=".repeat(72));
console.log('POSTER LOOKUP: "Ali" (property poster)');
const ali = findGroupPosterMatches("Ali", 1);
if (ali[0]) {
  console.log(`Sender: ${ali[0].sender}`);
  console.log(`Group: ${ali[0].groupName}`);
  console.log(`When: ${ali[0].timestamp}`);
  console.log(`Excerpt: ${ali[0].text.slice(0, 200).replace(/\s+/g, " ")}...`);
  console.log(`Contact: ${ali[0].contactHint || "none"}`);
}
