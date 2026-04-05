export type JsonRecord = Record<string, unknown>;

export const isRecord = (value: unknown): value is JsonRecord => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === "string" && value.length > 0;
};

export const readPositiveInt = (
  raw: string | undefined,
  fallback: number,
): number => {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

export const readBoolean = (
  raw: string | undefined,
  fallback: boolean,
): boolean => {
  if (!raw) {
    return fallback;
  }
  const lowered = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(lowered)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(lowered)) {
    return false;
  }
  return fallback;
};

export const slugify = (input: string): string => {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized.length > 0 ? normalized : "item";
};

export const serializePreview = (
  payload: unknown,
  maxLength = 12000,
): string => {
  try {
    const raw = JSON.stringify(payload, null, 2);
    if (raw.length <= maxLength) {
      return raw;
    }
    return `${raw.slice(0, maxLength)}\n...truncated`;
  } catch {
    return String(payload);
  }
};
