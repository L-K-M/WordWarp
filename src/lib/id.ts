let fallbackSequence = 0;

export function createId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;

  fallbackSequence += 1;
  return `ww-${Date.now().toString(36)}-${fallbackSequence.toString(36)}`;
}
