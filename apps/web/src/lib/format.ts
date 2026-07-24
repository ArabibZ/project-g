const dhakaDateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dhaka",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

const dhakaShort = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dhaka",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

const dhakaClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dhaka",
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatDhaka(value: string | null): string {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : `${dhakaDateTime.format(date)} Dhaka`;
}

export function formatDhakaShort(value: string | null): string {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : dhakaShort.format(date);
}

export function formatDhakaClock(now: number): string {
  return `${dhakaClock.format(new Date(now))} · Dhaka`;
}

export function formatRelative(value: string | null, now = Date.now()): string {
  if (!value) return "Not yet";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "Unknown";
  const seconds = Math.round((time - now) / 1000);
  if (Math.abs(seconds) < 60) return relative.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

export function compactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

export function initialsOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}
