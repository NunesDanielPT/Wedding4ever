import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<{ admin: boolean }>();

export function runAsAdmin<T>(admin: boolean, callback: () => T): T {
  return storage.run({ admin }, callback);
}

export function isAdminViewer(): boolean {
  return storage.getStore()?.admin ?? false;
}
