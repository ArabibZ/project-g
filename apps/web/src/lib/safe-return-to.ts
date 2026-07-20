const FALLBACK = "/dashboard";
const BASE = "https://project-g.invalid";
const UNSAFE_ENCODING = /%(?:0[0-9a-f]|1[0-9a-f]|5c|7f)/i;

export function safeReturnTo(value: string | null): string {
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    UNSAFE_ENCODING.test(value)
  ) {
    return FALLBACK;
  }

  try {
    const parsed = new URL(value, BASE);
    return parsed.origin === BASE
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : FALLBACK;
  } catch {
    return FALLBACK;
  }
}
