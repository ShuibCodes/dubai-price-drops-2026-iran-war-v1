import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const DATA_DIRECTORY = path.join(process.cwd(), ".data");
const COMPANY_ACCESS_FILE_PATH = path.join(DATA_DIRECTORY, "company-access.json");

function createEmptyStore() {
  return {
    records: [],
  };
}

function normalizeEmail(email) {
  return email?.trim().toLowerCase() ?? "";
}

function normalizeCompanyName(companyName) {
  return companyName?.trim() ?? "";
}

export function companyNameToSlug(companyName) {
  return companyName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function readCompanyAccessStore() {
  try {
    const rawStore = await readFile(COMPANY_ACCESS_FILE_PATH, "utf8");
    const parsedStore = JSON.parse(rawStore);
    return Array.isArray(parsedStore?.records) ? parsedStore : createEmptyStore();
  } catch (error) {
    return createEmptyStore();
  }
}

export async function writeCompanyAccessStore(store) {
  await mkdir(DATA_DIRECTORY, { recursive: true });
  await writeFile(COMPANY_ACCESS_FILE_PATH, JSON.stringify(store, null, 2));
}

export async function saveCompanyAccessRecord({ companyName, email }) {
  const normalizedCompanyName = normalizeCompanyName(companyName);
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedCompanyName || !normalizedEmail.includes("@")) {
    throw new Error("Company name and valid email are required.");
  }

  const companySlug = companyNameToSlug(normalizedCompanyName);

  if (!companySlug) {
    throw new Error("Could not generate a valid company URL.");
  }

  const store = await readCompanyAccessStore();
  const record = {
    companyName: normalizedCompanyName,
    companySlug,
    email: normalizedEmail,
    submittedAt: new Date().toISOString(),
  };

  store.records.push(record);
  await writeCompanyAccessStore(store);

  return record;
}
