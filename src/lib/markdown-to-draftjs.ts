/**
 * GrowLab markdown → X Articles content_state (DraftJS-like, snake_case).
 *
 * Supported: paragraphs, ATX headings (#–###; ####+ → header-three), setext headings,
 * bold/italic/strikethrough, links, unordered/ordered lists, blockquotes, @mentions,
 * #hashtags, $cashtags, standalone x.com/twitter.com status URLs as post embeds.
 *
 * Fallbacks (content preserved, never dropped):
 * - Fenced/indented code → unstyled text (X has no code-block type)
 * - Inline `code` → plain text
 * - Images ![alt](url) → link with alt text (inline images need a prior media_id; cover is separate)
 * - Horizontal rules skipped (no body text)
 * - Other markdown (tables, HTML, footnotes) → visible plain text
 */

export type DraftJsStyle = "bold" | "italic" | "strikethrough";

export type ContentBlockType =
  | "unstyled"
  | "header-one"
  | "header-two"
  | "header-three"
  | "unordered-list-item"
  | "ordered-list-item"
  | "blockquote"
  | "atomic";

export type InlineStyleRange = { offset: number; length: number; style: DraftJsStyle };
export type EntityRange = { key: number; offset: number; length: number };
export type TaggedSpan = { from_index: number; to_index: number; text: string };

export type ContentBlock = {
  key: string;
  text: string;
  type: ContentBlockType;
  inline_style_ranges?: InlineStyleRange[];
  entity_ranges?: EntityRange[];
  data?: {
    mentions?: TaggedSpan[];
    hashtags?: TaggedSpan[];
    cashtags?: TaggedSpan[];
    urls?: TaggedSpan[];
  };
};

export type ContentEntity = {
  key: string;
  value: {
    type: "link" | "image" | "post";
    mutability: "immutable" | "mutable" | "segmented";
    data: Record<string, unknown>;
  };
};

export type ContentState = {
  blocks: ContentBlock[];
  entities: ContentEntity[];
};

export type ConvertResult = ContentState & { warnings: string[] };

type Style = DraftJsStyle;

type ParsedInline = {
  text: string;
  styles: InlineStyleRange[];
  entityRanges: EntityRange[];
};

const STATUS_URL =
  /^(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/(\d+)(?:[/?#].*)?$/i;

export function markdownToDraftJs(markdown: string): ConvertResult {
  const warnings: string[] = [];
  const entities: ContentEntity[] = [];
  const blocks: ContentBlock[] = [];
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let blockN = 0;

  const pushBlock = (block: Omit<ContentBlock, "key">) => {
    const data = collectTagData(block.text);
    const next: ContentBlock = {
      key: `b${blockN++}`,
      ...block,
    };
    if (data) next.data = data;
    if (!next.inline_style_ranges?.length) delete next.inline_style_ranges;
    if (!next.entity_ranges?.length) delete next.entity_ranges;
    blocks.push(next);
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (/^```/.test(trimmed)) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      warnings.push("fenced code rendered as plain text (X Articles have no code-block type)");
      const body = (lang ? `(${lang})\n` : "") + codeLines.join("\n");
      for (const row of (body || " ").split("\n")) {
        pushBlock({ text: row.length ? row : " ", type: "unstyled" });
      }
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      i += 1;
      continue;
    }

    const atx = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (atx) {
      const level = Math.min(atx[1].length, 3);
      const type: ContentBlockType =
        level === 1 ? "header-one" : level === 2 ? "header-two" : "header-three";
      const heading = atx[2].replace(/\s+#+\s*$/, "");
      const parsed = parseInline(heading, entities, warnings);
      pushBlock({
        text: parsed.text || " ",
        type,
        inline_style_ranges: parsed.styles,
        entity_ranges: parsed.entityRanges,
      });
      i += 1;
      continue;
    }

    if (i + 1 < lines.length && /^(?:=+|-+)\s*$/.test(lines[i + 1].trim()) && trimmed) {
      const type: ContentBlockType = /^=+/.test(lines[i + 1].trim()) ? "header-one" : "header-two";
      const parsed = parseInline(trimmed, entities, warnings);
      pushBlock({
        text: parsed.text || " ",
        type,
        inline_style_ranges: parsed.styles,
        entity_ranges: parsed.entityRanges,
      });
      i += 2;
      continue;
    }

    const statusId = standaloneStatusId(trimmed);
    if (statusId) {
      const entityIndex = entities.length;
      entities.push({
        key: String(entityIndex),
        value: { type: "post", mutability: "immutable", data: { post_id: statusId } },
      });
      pushBlock({
        text: " ",
        type: "atomic",
        entity_ranges: [{ key: entityIndex, offset: 0, length: 1 }],
      });
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line) || trimmed.startsWith(">")) {
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        const q = lines[i].replace(/^>\s?/, "");
        const parsed = parseInline(q, entities, warnings);
        pushBlock({
          text: parsed.text || " ",
          type: "blockquote",
          inline_style_ranges: parsed.styles,
          entity_ranges: parsed.entityRanges,
        });
        i += 1;
      }
      continue;
    }

    const ul = trimmed.match(/^([-*+])\s+(.*)$/);
    if (ul) {
      while (i < lines.length) {
        const item = lines[i].trim().match(/^([-*+])\s+(.*)$/);
        if (!item) break;
        const parsed = parseInline(item[2], entities, warnings);
        pushBlock({
          text: parsed.text || " ",
          type: "unordered-list-item",
          inline_style_ranges: parsed.styles,
          entity_ranges: parsed.entityRanges,
        });
        i += 1;
      }
      continue;
    }

    const ol = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
    if (ol) {
      while (i < lines.length) {
        const item = lines[i].trim().match(/^(\d+)[.)]\s+(.*)$/);
        if (!item) break;
        const parsed = parseInline(item[2], entities, warnings);
        pushBlock({
          text: parsed.text || " ",
          type: "ordered-list-item",
          inline_style_ranges: parsed.styles,
          entity_ranges: parsed.entityRanges,
        });
        i += 1;
      }
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      const t = next.trim();
      if (!t) break;
      if (/^```/.test(t) || /^(#{1,6})\s+/.test(t) || /^>\s?/.test(next)) break;
      if (/^([-*+])\s+/.test(t) || /^\d+[.)]\s+/.test(t)) break;
      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(t)) break;
      if (standaloneStatusId(t)) break;
      if (i + 1 < lines.length && /^(?:=+|-+)\s*$/.test(lines[i + 1].trim())) break;
      para.push(next);
      i += 1;
    }
    const parsed = parseInline(para.map((l) => l.trim()).join(" "), entities, warnings);
    pushBlock({
      text: parsed.text || " ",
      type: "unstyled",
      inline_style_ranges: parsed.styles,
      entity_ranges: parsed.entityRanges,
    });
  }

  if (!blocks.length) {
    pushBlock({ text: " ", type: "unstyled" });
  }

  return { blocks, entities, warnings };
}

function standaloneStatusId(text: string): string | null {
  const m = text.trim().match(STATUS_URL);
  return m ? m[1] : null;
}

function parseInline(src: string, entities: ContentEntity[], warnings: string[]): ParsedInline {
  const out = walkInline(src, 0, null, new Set(), entities, warnings);
  return { text: out.text, styles: out.styles, entityRanges: out.entityRanges };
}

function walkInline(
  src: string,
  start: number,
  stop: string | null,
  active: Set<Style>,
  entities: ContentEntity[],
  warnings: string[],
): ParsedInline & { end: number } {
  let i = start;
  let text = "";
  const styles: InlineStyleRange[] = [];
  const entityRanges: EntityRange[] = [];

  const paintActive = (offset: number, length: number) => {
    for (const style of active) styles.push({ offset, length, style });
  };

  const append = (chunk: string) => {
    if (!chunk) return;
    paintActive(text.length, chunk.length);
    text += chunk;
  };

  while (i < src.length) {
    if (stop && src.startsWith(stop, i)) {
      return { text, styles, entityRanges, end: i };
    }

    const rest = src.slice(i);

    if (rest.startsWith("\\") && rest.length > 1) {
      append(rest[1]);
      i += 2;
      continue;
    }

    const img = rest.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
    if (img) {
      warnings.push("markdown image converted to a link (inline images need an uploaded media_id)");
      const alt = img[1] || img[2];
      const url = img[2];
      const entityIndex = entities.length;
      entities.push({
        key: String(entityIndex),
        value: { type: "link", mutability: "mutable", data: { url } },
      });
      entityRanges.push({ key: entityIndex, offset: text.length, length: alt.length });
      paintActive(text.length, alt.length);
      text += alt;
      i += img[0].length;
      continue;
    }

    const link = rest.match(/^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
    if (link) {
      const inner = walkInline(link[1], 0, null, active, entities, warnings);
      const entityIndex = entities.length;
      entities.push({
        key: String(entityIndex),
        value: { type: "link", mutability: "mutable", data: { url: link[2] } },
      });
      entityRanges.push({ key: entityIndex, offset: text.length, length: inner.text.length });
      for (const s of inner.styles) styles.push({ ...s, offset: s.offset + text.length });
      for (const e of inner.entityRanges) entityRanges.push({ ...e, offset: e.offset + text.length });
      text += inner.text;
      i += link[0].length;
      continue;
    }

    const autoUrl = rest.match(/^(https?:\/\/[^\s<]+)/);
    if (autoUrl && !src.startsWith("](", Math.max(0, i - 2))) {
      let url = autoUrl[1].replace(/[),.;!?]+$/, "");
      const entityIndex = entities.length;
      entities.push({
        key: String(entityIndex),
        value: { type: "link", mutability: "mutable", data: { url } },
      });
      entityRanges.push({ key: entityIndex, offset: text.length, length: url.length });
      paintActive(text.length, url.length);
      text += url;
      i += url.length;
      continue;
    }

    if (rest.startsWith("***") || rest.startsWith("___")) {
      const delim = rest.slice(0, 3);
      const inner = walkInline(src, i + 3, delim, withStyle(active, "bold", "italic"), entities, warnings);
      if (src.startsWith(delim, inner.end)) {
        for (const s of inner.styles) styles.push({ ...s, offset: s.offset + text.length });
        for (const e of inner.entityRanges) entityRanges.push({ ...e, offset: e.offset + text.length });
        text += inner.text;
        i = inner.end + 3;
        continue;
      }
    }

    if (rest.startsWith("**") || rest.startsWith("__")) {
      const delim = rest.slice(0, 2);
      const inner = walkInline(src, i + 2, delim, withStyle(active, "bold"), entities, warnings);
      if (src.startsWith(delim, inner.end)) {
        for (const s of inner.styles) styles.push({ ...s, offset: s.offset + text.length });
        for (const e of inner.entityRanges) entityRanges.push({ ...e, offset: e.offset + text.length });
        text += inner.text;
        i = inner.end + 2;
        continue;
      }
    }

    if (rest.startsWith("~~")) {
      const inner = walkInline(src, i + 2, "~~", withStyle(active, "strikethrough"), entities, warnings);
      if (src.startsWith("~~", inner.end)) {
        for (const s of inner.styles) styles.push({ ...s, offset: s.offset + text.length });
        for (const e of inner.entityRanges) entityRanges.push({ ...e, offset: e.offset + text.length });
        text += inner.text;
        i = inner.end + 2;
        continue;
      }
    }

    if (rest.startsWith("*") || rest.startsWith("_")) {
      const delim = rest[0];
      const prev = i > 0 ? src[i - 1] : " ";
      const nextCh = rest[1] || "";
      const flanked = !/\w/.test(prev) && nextCh && !/\s/.test(nextCh);
      if (flanked) {
        const inner = walkInline(src, i + 1, delim, withStyle(active, "italic"), entities, warnings);
        const after = inner.end + 1 < src.length ? src[inner.end + 1] : " ";
        if (src.startsWith(delim, inner.end) && !/\w/.test(after)) {
          for (const s of inner.styles) styles.push({ ...s, offset: s.offset + text.length });
          for (const e of inner.entityRanges) entityRanges.push({ ...e, offset: e.offset + text.length });
          text += inner.text;
          i = inner.end + 1;
          continue;
        }
      }
    }

    if (rest.startsWith("`")) {
      const close = src.indexOf("`", i + 1);
      if (close !== -1) {
        append(src.slice(i + 1, close));
        i = close + 1;
        continue;
      }
    }

    append(src[i]);
    i += 1;
  }

  return { text, styles, entityRanges, end: i };
}

function withStyle(active: Set<Style>, ...add: Style[]): Set<Style> {
  const next = new Set(active);
  for (const s of add) next.add(s);
  return next;
}

function collectTagData(text: string): ContentBlock["data"] | undefined {
  const mentions: TaggedSpan[] = [];
  const hashtags: TaggedSpan[] = [];
  const cashtags: TaggedSpan[] = [];
  const re = /([@#$])([A-Za-z][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const span = { from_index: m.index, to_index: m.index + m[0].length, text: m[0] };
    if (m[1] === "@") mentions.push(span);
    else if (m[1] === "#") hashtags.push(span);
    else cashtags.push(span);
  }
  const data: ContentBlock["data"] = {};
  if (mentions.length) data.mentions = mentions;
  if (hashtags.length) data.hashtags = hashtags;
  if (cashtags.length) data.cashtags = cashtags;
  return mentions.length || hashtags.length || cashtags.length ? data : undefined;
}
