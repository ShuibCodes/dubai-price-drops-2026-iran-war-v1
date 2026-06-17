import path from "path";
import { pathToFileURL } from "url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const mapped = pathToFileURL(
      path.join(process.cwd(), "src", specifier.slice(2)),
    ).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}
