import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const ACCESS_DIRECTORY = path.join(process.cwd(), ".data");
const ACCESS_FILE_PATH = path.join(ACCESS_DIRECTORY, "access-store.json");

function createEmptyStore() {
  return {
    lifetimeEmails: [],
  };
}

export async function readAccessStore() {
  try {
    const rawStore = await readFile(ACCESS_FILE_PATH, "utf8");
    const parsedStore = JSON.parse(rawStore);

    return Array.isArray(parsedStore?.lifetimeEmails)
      ? parsedStore
      : createEmptyStore();
  } catch (error) {
    return createEmptyStore();
  }
}

export async function writeAccessStore(store) {
  await mkdir(ACCESS_DIRECTORY, { recursive: true });
  await writeFile(ACCESS_FILE_PATH, JSON.stringify(store, null, 2));
}

export async function grantLifetimeAccess(email) {
  const normalizedEmail = email?.trim().toLowerCase();

  if (!normalizedEmail) {
    return;
  }

  const store = await readAccessStore();

  if (!store.lifetimeEmails.includes(normalizedEmail)) {
    store.lifetimeEmails.push(normalizedEmail);
    await writeAccessStore(store);
  }
}

export async function hasLifetimeAccess(email) {
  const normalizedEmail = email?.trim().toLowerCase();

  if (!normalizedEmail) {
    return false;
  }

  const store = await readAccessStore();
  return store.lifetimeEmails.includes(normalizedEmail);
}
