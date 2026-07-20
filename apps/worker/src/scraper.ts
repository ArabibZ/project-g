import { normalizeSourceUrl, type ScrapedJob } from "@project-g/shared";
import { fetchWithTimeout } from "./lib/http";

const MAX_HTML_BYTES = 3 * 1024 * 1024;
const TASK_PATH = /^\/tasks\/(\d+)\/details\/?$/;
const ANCHOR_PATTERN = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ");
}

function textContent(value: string): string {
  return decodeEntities(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function hrefFromAttributes(attributes: string): string | null {
  return attributes.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;
}

export function parseJobsHtml(html: string, sourceUrl: string): ScrapedJob[] {
  const jobs = new Map<string, ScrapedJob>();
  let fullCards = 0;
  let invalidCards = 0;

  for (const match of html.matchAll(ANCHOR_PATTERN)) {
    const attributes = match[1] ?? "";
    const body = match[2] ?? "";
    const heading = body.match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/i)?.[1];
    if (heading === undefined) continue;
    fullCards += 1;

    try {
      const rawHref = hrefFromAttributes(attributes);
      if (!rawHref) throw new Error("missing href");
      const details = new URL(decodeEntities(rawHref), sourceUrl);
      const path = details.pathname.match(TASK_PATH);
      if (
        details.protocol !== "https:" ||
        details.hostname !== "bot.gigclickers.com" ||
        details.username !== "" ||
        details.password !== "" ||
        (details.port !== "" && details.port !== "443") ||
        !path?.[1]
      ) {
        throw new Error("invalid details URL");
      }

      const name = textContent(heading);
      const cardText = textContent(body);
      const payment = cardText.match(/\$\d+(?:\.\d+)?/)?.[0];
      const progress = cardText.match(/\b(\d+)\s*\/\s*(\d+)\b/);
      if (!name || name.length > 500 || !payment || !progress?.[1] || !progress[2]) {
        throw new Error("missing required field");
      }
      const doneCount = Number(progress[1]);
      const totalTarget = Number(progress[2]);
      if (!Number.isSafeInteger(doneCount) || !Number.isSafeInteger(totalTarget) || totalTarget < 1 || doneCount > totalTarget) {
        throw new Error("invalid progress");
      }

      const job: ScrapedJob = {
        jobId: path[1],
        name,
        doneCount,
        totalTarget,
        payment,
        detailsUrl: details.toString()
      };
      const previous = jobs.get(job.jobId);
      if (previous && JSON.stringify(previous) !== JSON.stringify(job)) {
        throw new Error("conflicting duplicate job ID");
      }
      jobs.set(job.jobId, job);
    } catch {
      invalidCards += 1;
    }
  }

  if (fullCards === 0 || invalidCards > 0 || jobs.size === 0) {
    throw new Error(
      `Source structure check failed (${jobs.size} valid, ${invalidCards} invalid, ${fullCards} full cards)`
    );
  }
  return [...jobs.values()];
}

async function boundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_HTML_BYTES) throw new Error("Source response too large");
  if (!response.body) throw new Error("Source returned an empty response");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error("Source response too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function scrapeSource(rawUrl: string): Promise<ScrapedJob[]> {
  let url = normalizeSourceUrl(rawUrl);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetchWithTimeout(
      url,
      {
        redirect: "manual",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Project-G/1.0 (+public-task-monitor)"
        }
      },
      20_000
    );

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new Error("Source redirect rejected");
      url = normalizeSourceUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
    if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) {
      throw new Error("Source did not return HTML");
    }
    return parseJobsHtml(await boundedText(response), url);
  }
  throw new Error("Source redirect rejected");
}
