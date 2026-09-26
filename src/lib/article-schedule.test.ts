import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeScheduledFor, r2KeyFromCoverUrl, statusForSchedulePatch, toSqliteUtc } from "./article-schedule.ts";

describe("article-schedule", () => {
  it("stores ISO as sqlite UTC for cron comparison", () => {
    assert.equal(toSqliteUtc("2026-10-03T09:00:00.000Z"), "2026-10-03 09:00:00");
    assert.equal(normalizeScheduledFor("2026-10-10T09:00:00Z"), "2026-10-10 09:00:00");
    assert.equal(normalizeScheduledFor(""), null);
    assert.equal(normalizeScheduledFor(null), null);
  });

  it("flips status to scheduled when scheduled_for is set without an explicit status", () => {
    assert.equal(statusForSchedulePatch("2026-10-03 09:00:00"), "scheduled");
    assert.equal(statusForSchedulePatch(null), "draft");
    assert.equal(statusForSchedulePatch("2026-10-03 09:00:00", "draft"), undefined);
  });

  it("extracts R2 keys from /api/media cover URLs", () => {
    assert.equal(r2KeyFromCoverUrl("/api/media/covers/art_abc.png"), "covers/art_abc.png");
    assert.equal(
      r2KeyFromCoverUrl("https://growlab.darylbleach.workers.dev/api/media/covers/art_abc.png"),
      "covers/art_abc.png",
    );
    assert.equal(r2KeyFromCoverUrl("https://cdn.example/cover.png"), null);
  });
});
