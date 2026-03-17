const ensureCrypto = (): void => {
  const hasCrypto =
    typeof globalThis !== 'undefined' &&
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function';

  if (hasCrypto) {
    return;
  }

  try {
    // Access require via globalThis to prevent bundlers (esbuild/Convex) from
    // statically tracing this as a module dependency. In React Native/Expo,
    // `require` is available on globalThis; in Convex/Node.js/browsers it is not.
    const rn = (globalThis as { require?: (id: string) => unknown }).require;
    if (rn) rn('react-native-get-random-values');
  } catch {
    // Ignore if the polyfill isn't available; uuidv4 will throw below.
  }
};

export function uuidv4(): string {
  ensureCrypto();

  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && 'getRandomValues' in (crypto as Crypto)) {
    const bytes = new Uint8Array(16);
    (crypto as Crypto).getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  throw new Error('crypto.getRandomValues not available for uuidv4');
}
