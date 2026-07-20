import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  delayFromSample,
  dhakaDayStart,
  escapeTelegramHtml,
  normalizeSourceUrl,
  sourceUrlSchema
} from "../packages/shared/src/index";
import { isAdminProfile, validateAdminClaims } from "../apps/worker/src/auth";
import { parseJobsHtml } from "../apps/worker/src/scraper";
import { safeReturnTo } from "../apps/web/src/lib/safe-return-to";
import {
  classifyTelegramError,
  jobMessage,
  telegramRetryDelaySeconds
} from "../apps/worker/src/telegram";

const SOURCE_URL = "https://bot.gigclickers.com/";
const USER_ID = "8f3cb9f0-0b75-42bd-a368-65f4bf65e289";
const SESSION_ID = "234900b9-f4d7-421a-b588-9a3ac34f61d4";
const ISSUER = "https://project.supabase.co/auth/v1";
const NOW = Date.parse("2026-07-20T12:00:00Z");
const fixture = await readFile(
  new URL("./fixtures/gigclickers-task-cards.html", import.meta.url),
  "utf8"
);

describe("shared source URL", () => {
  test("allows GigClickers HTTPS and normalizes path, query, and fragment", () => {
    const input = "  https://BOT.GIGCLICKERS.COM:443//tasks///?q=YouTube Job&view=all#mobile  ";
    const normalized = "https://bot.gigclickers.com/tasks/?q=YouTube%20Job&view=all";

    expect(normalizeSourceUrl(input)).toBe(normalized);
    expect(sourceUrlSchema.parse(input)).toBe(normalized);
  });

  test.each([
    "http://bot.gigclickers.com/",
    "https://evil.example/",
    "https://bot.gigclickers.com.evil.example/",
    "https://user@bot.gigclickers.com/",
    "https://bot.gigclickers.com:444/"
  ])("rejects unsafe source URL: %s", (url) => {
    expect(() => normalizeSourceUrl(url)).toThrow("URL must use HTTPS on bot.gigclickers.com");
    expect(sourceUrlSchema.safeParse(url).success).toBeFalse();
  });
});

describe("scheduler timing", () => {
  test("maps deterministic Uint16 endpoints to inclusive 4-7 minute bounds", () => {
    expect(delayFromSample(0)).toBe(240);
    expect(delayFromSample(65_535)).toBe(420);

    const samples = [0, 1, 32_768, 65_534, 65_535];
    expect(samples.map(delayFromSample)).toEqual([240, 240, 330, 420, 420]);
  });

  test("changes Dhaka day exactly at 18:00 UTC", () => {
    expect(dhakaDayStart(new Date("2026-07-19T17:59:59.999Z"))).toBe(
      "2026-07-19T00:00:00+06:00"
    );
    expect(dhakaDayStart(new Date("2026-07-19T18:00:00.000Z"))).toBe(
      "2026-07-20T00:00:00+06:00"
    );
  });
});

describe("Telegram HTML and delivery policy", () => {
  test("escapes every Telegram HTML metacharacter", () => {
    expect(escapeTelegramHtml('<b title="A&B">x</b>')).toBe(
      "&lt;b title=&quot;A&amp;B&quot;&gt;x&lt;/b&gt;"
    );
  });

  test("builds escaped HTML delivery message", () => {
    expect(jobMessage({
      job_id: "7<&",
      name: '<b>A&B "job"</b>',
      done_count: 1,
      total_target: 2,
      payment: "$0.01 & bonus",
      details_url: 'https://bot.gigclickers.com/tasks/7/details?a=1&b="x"'
    })).toBe([
      "<b>NEW</b>",
      "<b>ID:</b> 7&lt;&amp;",
      "<b>Name:</b> &lt;b&gt;A&amp;B &quot;job&quot;&lt;/b&gt;",
      "<b>Progress:</b> 1/2",
      "<b>Payment:</b> $0.01 &amp; bonus",
      '<a href="https://bot.gigclickers.com/tasks/7/details?a=1&amp;b=&quot;x&quot;">Open Job</a>'
    ].join("\n"));
  });

  test("classifies permanent subscriber failures and temporary retries", () => {
    expect(classifyTelegramError(403, 403, "Forbidden: bot was blocked by the user", null))
      .toMatchObject({ kind: "blocked", retryAfterSeconds: null, ambiguous: false });
    expect(classifyTelegramError(400, 400, "Bad Request: chat not found", null))
      .toMatchObject({ kind: "unavailable" });
    expect(classifyTelegramError(429, 429, "Too Many Requests", 75))
      .toMatchObject({ kind: "temporary", retryAfterSeconds: 75 });
    expect(classifyTelegramError(400, 400, "Bad Request", null))
      .toMatchObject({ kind: "permanent" });
  });

  test("uses linear retry floor but respects Telegram retry_after", () => {
    expect(telegramRetryDelaySeconds(1, null)).toBe(30);
    expect(telegramRetryDelaySeconds(2, 90)).toBe(90);
  });
});

describe("GigClickers fixture parser", () => {
  test("extracts observed card fields", () => {
    expect(parseJobsHtml(fixture, SOURCE_URL)).toEqual([
      {
        jobId: "142901",
        name: "নতুন Gmail অ্যাকাউন্ট তৈরি (সহজ কাজ)",
        doneCount: 5,
        totalTarget: 15,
        payment: "$0.080",
        detailsUrl: "https://bot.gigclickers.com/tasks/142901/details"
      },
      {
        jobId: "142887",
        name: "YouTube ভিডিও দেখে ইনকাম💸🫶MkN3",
        doneCount: 204,
        totalTarget: 206,
        payment: "$0.022",
        detailsUrl: "https://bot.gigclickers.com/tasks/142887/details"
      }
    ]);
  });

  test("dedupes responsive compact copy lacking h4", () => {
    const copies = [...fixture.matchAll(/<a\b[^>]*142887[\s\S]*?<\/a>/g)];
    expect(copies).toHaveLength(2);
    expect(copies.filter(([card]) => card.includes("<h4"))).toHaveLength(1);
    expect(parseJobsHtml(fixture, SOURCE_URL).filter((job) => job.jobId === "142887"))
      .toHaveLength(1);
  });

  test.each([
    '<a href="/tasks/1/details"><h4>Missing payment</h4><span>1/2</span></a>',
    '<a href="https://evil.example/tasks/1/details"><h4>Wrong host</h4><span>$0.01 1/2</span></a>',
    '<a href="https://user@bot.gigclickers.com/tasks/1/details"><h4>Credentials</h4><span>$0.01 1/2</span></a>',
    '<a href="https://bot.gigclickers.com:444/tasks/1/details"><h4>Custom port</h4><span>$0.01 1/2</span></a>',
    '<a href="/tasks/1/details"><h4>Impossible progress</h4><span>$0.01 3/2</span></a>'
  ])("rejects invalid or malformed full card", (html) => {
    expect(() => parseJobsHtml(html, SOURCE_URL)).toThrow("Source structure check failed");
  });

  test("fails source when one semantic card changes route structure", () => {
    const html = [
      '<a href="/tasks/1/details"><h4>Valid</h4><span>$0.01 1/2</span></a>',
      '<a href="/work/2"><h4>Changed route</h4><span>$0.02 1/2</span></a>'
    ].join("\n");
    expect(() => parseJobsHtml(html, SOURCE_URL)).toThrow(
      "Source structure check failed (1 valid, 1 invalid, 2 full cards)"
    );
  });

  test("rejects conflicting cards sharing one job ID", () => {
    const html = [
      '<a href="/tasks/1/details"><h4>First title</h4><span>$0.01 1/2</span></a>',
      '<a href="/tasks/1/details"><h4>Changed title</h4><span>$0.01 1/2</span></a>'
    ].join("\n");

    expect(() => parseJobsHtml(html, SOURCE_URL)).toThrow(
      "Source structure check failed (1 valid, 1 invalid, 2 full cards)"
    );
  });
});

describe("same-origin return path", () => {
  test("preserves a normalized local destination", () => {
    expect(safeReturnTo("/jobs?q=142887#result")).toBe("/jobs?q=142887#result");
  });

  test.each([
    null,
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    "/%5cevil.example/",
    "/jobs%0d%0aLocation:https://evil.example/"
  ])("rejects unsafe return destination: %s", (value) => {
    expect(safeReturnTo(value)).toBe("/dashboard");
  });
});

describe("admin auth validation", () => {
  const claims = {
    sub: USER_ID,
    iss: ISSUER,
    aud: "authenticated",
    role: "authenticated",
    aal: "aal2",
    exp: Math.floor(NOW / 1000) + 60,
    session_id: SESSION_ID
  };

  test("accepts matching unexpired AAL2 admin identity", () => {
    expect(validateAdminClaims(claims, USER_ID, ISSUER, true, NOW)).toMatchObject({
      sub: USER_ID,
      aal: "aal2"
    });
    expect(isAdminProfile({ id: USER_ID, role: "admin" }, USER_ID)).toBeTrue();
  });

  test.each([
    { ...claims, sub: "fbc90d1b-c50b-48a8-adfb-93b1fcdd100c" },
    { ...claims, iss: "https://evil.example/auth/v1" },
    { ...claims, aud: "anon" },
    { ...claims, exp: Math.floor(NOW / 1000) }
  ])("rejects mismatched or expired claims", (candidate) => {
    expect(() => validateAdminClaims(candidate, USER_ID, ISSUER, true, NOW))
      .toThrow("Unauthorized");
  });

  test("requires AAL2 only when requested", () => {
    const aal1 = { ...claims, aal: "aal1" };
    expect(() => validateAdminClaims(aal1, USER_ID, ISSUER, true, NOW))
      .toThrow("MFA_REQUIRED");
    expect(validateAdminClaims(aal1, USER_ID, ISSUER, false, NOW).aal).toBe("aal1");
  });

  test("rejects non-admin or mismatched profile", () => {
    expect(isAdminProfile({ id: USER_ID, role: "viewer" }, USER_ID)).toBeFalse();
    expect(isAdminProfile(
      { id: "fbc90d1b-c50b-48a8-adfb-93b1fcdd100c", role: "admin" },
      USER_ID
    )).toBeFalse();
  });
});
