function nowIso() {
  return new Date().toISOString();
}

function toIso(value) {
  if (!value) {
    return nowIso();
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return nowIso();
  }
  return date.toISOString();
}

function hoursAgo(hours, from = new Date()) {
  return new Date(from.getTime() - hours * 60 * 60 * 1000);
}

function sameUtcDay(a, b) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

module.exports = {
  nowIso,
  toIso,
  hoursAgo,
  sameUtcDay
};
