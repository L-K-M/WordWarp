export type ServiceWorkerUpdate = () => Promise<void>;

let pendingUpdate: ServiceWorkerUpdate | null = null;
const listeners = new Set<(update: ServiceWorkerUpdate) => void>();

export function announceServiceWorkerUpdate(update: ServiceWorkerUpdate): void {
  pendingUpdate = update;
  for (const listener of listeners) listener(update);
}

export function subscribeToServiceWorkerUpdate(listener: (update: ServiceWorkerUpdate) => void): () => void {
  listeners.add(listener);
  if (pendingUpdate) listener(pendingUpdate);
  return () => listeners.delete(listener);
}
