export const MAX_LINKED_REFS = 10;

const MAX_REF = 2147483647;
const PLAIN_REF = /^[1-9]\d{0,9}$/;

/** Refs 1..2147483647 written as plain digits (numbers must be safe integers in range), as strings,
 *  deduplicated, ascending by number, at most MAX_LINKED_REFS. Anything else is dropped. */
export function normalizeLinkedRefs(refs: readonly (string | number)[]): string[] {
  const kept = new Set<number>();
  for (const ref of refs) {
    const n = typeof ref === 'number' ? ref : PLAIN_REF.test(ref) ? Number(ref) : Number.NaN;
    if (Number.isSafeInteger(n) && n >= 1 && n <= MAX_REF) kept.add(n);
  }
  return [...kept]
    .sort((a, b) => a - b)
    .slice(0, MAX_LINKED_REFS)
    .map(String);
}
