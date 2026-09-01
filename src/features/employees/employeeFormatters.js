export const DEFAULT_TIMEZONE = "America/New_York";

export const todayInput = () => new Date().toISOString().slice(0, 10);

export function localDateTimeInput(value = new Date().toISOString(), timeZone = DEFAULT_TIMEZONE) {
  const date = new Date(value || new Date().toISOString());
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date).reduce((out, part) => {
    if (part.type !== "literal") out[part.type] = part.value;
    return out;
  }, {});
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

function timezoneOffsetMs(date, timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date).reduce((out, part) => {
    if (part.type !== "literal") out[part.type] = part.value;
    return out;
  }, {});
  const hour = parts.hour === "24" ? "00" : parts.hour;
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(hour), Number(parts.minute), Number(parts.second));
  return asUtc - date.getTime();
}

export function dateTimeInputToIso(value, timeZone = DEFAULT_TIMEZONE) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || ""));
  if (!match) return "";
  const [, year, month, day, hour, minute, second = "00"] = match;
  const localAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  let utc = localAsUtc - timezoneOffsetMs(new Date(localAsUtc), timeZone);
  utc = localAsUtc - timezoneOffsetMs(new Date(utc), timeZone);
  return new Date(utc).toISOString();
}

export function announcementDisplayStatus(item, reference = new Date()) {
  if (item.archived_at) return "Archived";
  const publishAt = new Date(item.publish_at);
  const expiresAt = item.expires_at ? new Date(item.expires_at) : null;
  if (!Number.isNaN(publishAt.getTime()) && publishAt > reference) return "Scheduled";
  if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt <= reference) return "Expired";
  return "Active";
}

export function dollarsToCents(value) {
  return Math.round(Number(value || 0) * 100);
}

export function centsToDollars(value) {
  return (Number(value || 0) / 100).toFixed(2);
}

export function minutesLabel(minutes = 0) {
  return `${(Number(minutes || 0) / 60).toFixed(2)} hrs`;
}
