import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isEligibleForWorst, WORST_POSTS_SQL } from "./analytics-worst.ts";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const H = 60 * 60 * 1000;

describe("isEligibleForWorst", () => {
  it("excludes missing created_at_x (fail closed)", () => {
    assert.equal(isEligibleForWorst(null, NOW), false);
    assert.equal(isEligibleForWorst(undefined, NOW), false);
    assert.equal(isEligibleForWorst("", NOW), false);
    assert.equal(isEligibleForWorst("   ", NOW), false);
  });

  it("excludes unparseable created_at_x (fail closed)", () => {
    assert.equal(isEligibleForWorst("not-a-date", NOW), false);
  });

  it("excludes posts younger than 24h", () => {
    assert.equal(isEligibleForWorst("2026-09-26T11:00:00.000Z", NOW), false);
    assert.equal(isEligibleForWorst("2026-09-25T12:00:01.000Z", NOW), false);
  });

  it("includes posts at or older than 24h", () => {
    assert.equal(isEligibleForWorst("2026-09-25T12:00:00.000Z", NOW), true);
    assert.equal(isEligibleForWorst(new Date(NOW - 24 * H).toISOString(), NOW), true);
    assert.equal(isEligibleForWorst("2026-09-20T00:00:00.000Z", NOW), true);
  });
});

describe("WORST_POSTS_SQL", () => {
  it("filters replies, applies 24h age, and does not change top-post ordering", () => {
    assert.match(WORST_POSTS_SQL, /is_reply = 0/);
    assert.match(WORST_POSTS_SQL, /created_at_x IS NOT NULL/);
    assert.match(WORST_POSTS_SQL, /datetime\('now', '-24 hours'\)/);
    assert.match(WORST_POSTS_SQL, /ORDER BY impressions ASC, likes ASC/);
    assert.match(WORST_POSTS_SQL, /LIMIT 10/);
    assert.doesNotMatch(WORST_POSTS_SQL, /impressions DESC/);
  });
});
