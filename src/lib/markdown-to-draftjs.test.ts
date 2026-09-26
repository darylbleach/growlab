import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { markdownToDraftJs } from "./markdown-to-draftjs.ts";

const OTD_SHAPE = `# On The Day

The morning of the wedding is not the time to improvise.

## What to pack

- rings
- vows
- **the license**

Read the checklist at [this guide](https://example.com/otd).

> Don't forget to eat.

1. Wake up
2. Get dressed

Contact @darylbleach and search #wedding.

![Mood](https://example.com/cover.png)

\`\`\`js
console.log("not a real code block on X")
\`\`\`
`;

describe("markdownToDraftJs", () => {
  it("converts OTD/TTK-like markdown without dropping body text", () => {
    const out = markdownToDraftJs(OTD_SHAPE);
    const types = out.blocks.map((b) => b.type);
    assert.equal(types[0], "header-one");
    assert.equal(out.blocks[0].text, "On The Day");
    assert.ok(types.includes("header-two"));
    assert.ok(types.includes("unordered-list-item"));
    assert.ok(types.includes("ordered-list-item"));
    assert.ok(types.includes("blockquote"));
    assert.ok(out.blocks.some((b) => b.text.includes("improvise")));
    assert.ok(out.blocks.some((b) => b.text.includes("console.log")));
    assert.ok(out.blocks.some((b) => b.inline_style_ranges?.some((s) => s.style === "bold")));
    const link = out.entities.find((e) => e.value.type === "link" && e.value.data.url === "https://example.com/otd");
    assert.ok(link);
    assert.ok(out.blocks.some((b) => b.data?.mentions?.length));
    assert.ok(out.blocks.some((b) => b.data?.hashtags?.length));
    assert.ok(out.entities.some((e) => e.value.data.url === "https://example.com/cover.png"));
    assert.ok(out.warnings.some((w) => /code/.test(w)));
    assert.ok(out.warnings.some((w) => /image/.test(w)));
  });

  it("uses snake_case DraftJS fields and integer entity_ranges keys", () => {
    const out = markdownToDraftJs("See [GrowLab](https://growlab.example) please.");
    const block = out.blocks[0];
    assert.ok(block.entity_ranges);
    assert.equal(typeof block.entity_ranges![0].key, "number");
    assert.equal(out.entities[0].key, "0");
    assert.equal(out.entities[0].value.mutability, "mutable");
    assert.ok(!("inlineStyleRanges" in block));
    assert.ok(!("entityRanges" in block));
  });

  it("embeds a standalone X status URL as a post atomic block", () => {
    const out = markdownToDraftJs("https://x.com/darylbleach/status/1234567890123456789");
    assert.equal(out.blocks[0].type, "atomic");
    assert.equal(out.entities[0].value.type, "post");
    assert.equal(out.entities[0].value.data.post_id, "1234567890123456789");
  });

  it("never returns an empty blocks array", () => {
    const out = markdownToDraftJs("   \n\n");
    assert.ok(out.blocks.length >= 1);
    assert.equal(out.blocks[0].type, "unstyled");
  });

  it("maps ####+ headings down to header-three", () => {
    const out = markdownToDraftJs("#### Deep");
    assert.equal(out.blocks[0].type, "header-three");
    assert.equal(out.blocks[0].text, "Deep");
  });
});
