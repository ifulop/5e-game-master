import { AsyncLocalStorage } from 'node:async_hooks';

export const campaignStorage = new AsyncLocalStorage();

export function campaignDir() {
  return campaignStorage.getStore() ?? null;
}
