export const DUBAI_AREAS = [
  { canonical: "Dubai Marina", shortCode: "Marina", aliases: ["marina", "dubai marina"] },
  { canonical: "Jumeirah Beach Residence", shortCode: "JBR", aliases: ["jbr", "jumeirah beach residence"] },
  { canonical: "Downtown Dubai", shortCode: "Downtown", aliases: ["downtown", "downtown dubai"] },
  { canonical: "Business Bay", shortCode: "BB", aliases: ["business bay", "bb"] },
  { canonical: "Jumeirah Village Circle", shortCode: "JVC", aliases: ["jvc", "jumeirah village circle"] },
  { canonical: "Jumeirah Village Triangle", shortCode: "JVT", aliases: ["jvt", "jumeirah village triangle"] },
  { canonical: "Jumeirah Lakes Towers", shortCode: "JLT", aliases: ["jlt", "jumeirah lakes towers"] },
  { canonical: "Palm Jumeirah", shortCode: "Palm", aliases: ["palm", "palm jumeirah"] },
  { canonical: "Dubai Hills Estate", shortCode: "DHE", aliases: ["dhe", "dubai hills", "dubai hills estate"] },
  { canonical: "Arabian Ranches", shortCode: "AR", aliases: ["arabian ranches", "ar"] },
  { canonical: "Arabian Ranches 2", shortCode: "AR2", aliases: ["arabian ranches 2", "ar2"] },
  { canonical: "Arabian Ranches 3", shortCode: "AR3", aliases: ["arabian ranches 3", "ar3"] },
  { canonical: "Damac Hills", shortCode: "DH", aliases: ["damac hills", "dh"] },
  { canonical: "Damac Hills 2", shortCode: "DH2", aliases: ["damac hills 2", "dh2"] },
  { canonical: "Mohammed Bin Rashid City", shortCode: "MBR City", aliases: ["mbr", "mbr city", "mohammed bin rashid city"] },
  { canonical: "Dubai Creek Harbour", shortCode: "DCH", aliases: ["dch", "creek harbour", "dubai creek harbour"] },
  { canonical: "Emaar Beachfront", shortCode: "Beachfront", aliases: ["emaar beachfront", "beachfront"] },
  { canonical: "The Springs", shortCode: "Springs", aliases: ["the springs", "springs"] },
  { canonical: "The Meadows", shortCode: "Meadows", aliases: ["the meadows", "meadows"] },
  { canonical: "The Lakes", shortCode: "Lakes", aliases: ["the lakes", "lakes"] },
  { canonical: "Emirates Hills", shortCode: "EH", aliases: ["emirates hills", "eh"] },
  { canonical: "Al Barsha", shortCode: "Barsha", aliases: ["al barsha", "barsha"] },
  { canonical: "Barsha Heights / TECOM", shortCode: "Barsha Heights", aliases: ["barsha heights", "tecom"] },
  { canonical: "Mirdif", shortCode: "Mirdif", aliases: ["mirdif"] },
  { canonical: "Al Furjan", shortCode: "Furjan", aliases: ["al furjan", "furjan"] },
  { canonical: "Discovery Gardens", shortCode: "DG", aliases: ["discovery gardens", "dg"] },
  { canonical: "International City", shortCode: "IC", aliases: ["international city", "ic"] },
  { canonical: "Dubai Sports City", shortCode: "DSC", aliases: ["dubai sports city", "dsc"] },
  { canonical: "Dubai Investment Park", shortCode: "DIP", aliases: ["dubai investment park", "dip"] },
  { canonical: "Dubai South", shortCode: "DS", aliases: ["dubai south", "ds"] },
  { canonical: "Bluewaters Island", shortCode: "Bluewaters", aliases: ["bluewaters", "bluewaters island"] },
  { canonical: "Al Jaddaf", shortCode: "Jaddaf", aliases: ["al jaddaf", "jaddaf"] },
  { canonical: "Ras Al Khor", shortCode: "RAK", aliases: ["ras al khor", "rak"] },
  { canonical: "Meydan", shortCode: "Meydan", aliases: ["meydan"] },
  { canonical: "Sobha Hartland", shortCode: "Sobha", aliases: ["sobha hartland", "sobha"] },
  { canonical: "Dubai Production City", shortCode: "IMPZ", aliases: ["impz", "dubai production city"] },
  { canonical: "Jumeirah", shortCode: "Jumeirah", aliases: ["jumeirah"] },
  { canonical: "Bur Dubai", shortCode: "Bur Dubai", aliases: ["bur dubai"] },
  { canonical: "Deira", shortCode: "Deira", aliases: ["deira"] },
  { canonical: "Sheikh Zayed Road", shortCode: "SZR", aliases: ["sheikh zayed road", "szr"] },
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findAreasInText(text) {
  const haystack = String(text || "").toLowerCase();
  const matches = [];

  for (const area of DUBAI_AREAS) {
    let firstIndex = Number.POSITIVE_INFINITY;
    for (const alias of area.aliases) {
      const aliasText = alias.toLowerCase().trim();
      const regex = new RegExp(`\\b${escapeRegex(aliasText)}\\b`, "i");
      const match = haystack.match(regex);
      const index = match?.index ?? -1;
      if (index !== -1 && index < firstIndex) {
        firstIndex = index;
      }
    }

    if (firstIndex !== Number.POSITIVE_INFINITY) {
      matches.push({ ...area, firstIndex });
    }
  }

  return matches.sort((a, b) => a.firstIndex - b.firstIndex);
}
