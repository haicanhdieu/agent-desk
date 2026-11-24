/** Lowercase, drop one leading `<vendor>/`, drop a trailing `:<suffix>`, and turn `.` into `-`. */
export function normalizeModelKey(model: string): string {
  let key = model.toLowerCase();
  const slash = key.indexOf('/');
  if (slash >= 0) key = key.slice(slash + 1);
  const colon = key.lastIndexOf(':');
  if (colon >= 0) key = key.slice(0, colon);
  return key.replaceAll('.', '-');
}
