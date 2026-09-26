export const MAX_POST_IMAGES = 4;

export type PostPart = {
  text: string;
  media_keys?: string[];
};

export type PostPartInput = string | { text?: string; media_keys?: unknown };

export function isValidMediaKey(key: string): boolean {
  if (!key || key.length > 500) return false;
  if (key.includes("..") || key.startsWith("/") || key.includes("\\") || key.includes("\0")) return false;
  return key.startsWith("uploads/");
}

export class MediaKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaKeyError";
  }
}

export function requireMediaKeys(keys: unknown): string[] {
  if (keys === undefined || keys === null) return [];
  if (!Array.isArray(keys)) throw new MediaKeyError("media_keys must be an array of R2 object keys");
  if (keys.length > MAX_POST_IMAGES) throw new MediaKeyError("at most 4 images per post");
  const out: string[] = [];
  for (const raw of keys) {
    if (typeof raw !== "string") throw new MediaKeyError("media_keys must be strings");
    const key = raw.trim();
    if (!isValidMediaKey(key)) throw new MediaKeyError(`invalid media_key: ${key || "(empty)"}`);
    if (!out.includes(key)) out.push(key);
  }
  if (out.length > MAX_POST_IMAGES) throw new MediaKeyError("at most 4 images per post");
  return out;
}

export function normalizePostParts(body: {
  text?: string;
  parts?: PostPartInput[];
  media_keys?: unknown;
}): PostPart[] {
  if (body.parts?.length) {
    return body.parts.map((part) => {
      if (typeof part === "string") return { text: part };
      const media_keys = requireMediaKeys(part.media_keys);
      return {
        text: typeof part.text === "string" ? part.text : "",
        ...(media_keys.length ? { media_keys } : {}),
      };
    });
  }
  const media_keys = requireMediaKeys(body.media_keys);
  return [
    {
      text: body.text || "",
      ...(media_keys.length ? { media_keys } : {}),
    },
  ];
}

export function parsePartsJson(text: string, partsJson: string | null | undefined): PostPart[] {
  if (!partsJson) return [{ text }];
  try {
    const raw = JSON.parse(partsJson) as unknown;
    if (!Array.isArray(raw) || raw.length === 0) return [{ text }];
    return normalizePostParts({ parts: raw as PostPartInput[] });
  } catch {
    return [{ text }];
  }
}

/** Strict parse for publish — invalid/unreadable keys must throw, never drop images. */
export function partsForPublish(text: string, partsJson: string | null | undefined): PostPart[] {
  if (!partsJson) return [{ text }];
  let raw: unknown;
  try {
    raw = JSON.parse(partsJson);
  } catch {
    throw new MediaKeyError("parts_json is not valid JSON");
  }
  if (!Array.isArray(raw) || raw.length === 0) return [{ text }];
  return raw.map((part, i) => {
    if (typeof part === "string") return { text: part };
    if (!part || typeof part !== "object") {
      throw new MediaKeyError(`parts_json[${i}] is invalid`);
    }
    const obj = part as { text?: unknown; media_keys?: unknown };
    const textVal = typeof obj.text === "string" ? obj.text : "";
    const media_keys = requireMediaKeys(obj.media_keys);
    return {
      text: textVal,
      ...(media_keys.length ? { media_keys } : {}),
    };
  });
}

export function countMediaKeys(parts: PostPart[]): number {
  return parts.reduce((n, p) => n + (p.media_keys?.length || 0), 0);
}
