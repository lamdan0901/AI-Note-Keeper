declare const require: (id: string) => unknown;

const ensureCrypto = (): void => {
  const hasCrypto =
    typeof globalThis !== "undefined" &&
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.getRandomValues === "function";

  if (hasCrypto) {
    return;
  }

  try {
    // Polyfill for React Native/Expo environments.
    require("react-native-get-random-values");
  } catch {
    // Ignore if the polyfill isn't available; uuidv4 will throw below.
  }
};

export function uuidv4(): string {
  ensureCrypto();

  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  throw new Error("crypto.getRandomValues not available for uuidv4");
}
