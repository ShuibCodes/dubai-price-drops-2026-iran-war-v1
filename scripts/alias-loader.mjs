import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

function resolveSrcPath(specifier) {
  const rel = specifier.startsWith("@/")
    ? path.join("src", specifier.slice(2))
    : null;
  if (!rel) return null;

  const absolute = path.join(process.cwd(), rel);
  if (fs.existsSync(absolute)) return absolute;
  if (!path.extname(absolute) && fs.existsSync(`${absolute}.js`)) {
    return `${absolute}.js`;
  }
  if (!path.extname(absolute) && fs.existsSync(`${absolute}.mjs`)) {
    return `${absolute}.mjs`;
  }
  return absolute;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const mapped = resolveSrcPath(specifier);
    return nextResolve(pathToFileURL(mapped).href, context);
  }
  return nextResolve(specifier, context);
}
