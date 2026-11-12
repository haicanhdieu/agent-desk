/** Personal-org slug from a user handle: lowercase, `[^a-z0-9-]` -> `-`; `-2`, `-3`, ... on collision. */
export async function slugFromHandle(handle: string, taken: (slug: string) => Promise<boolean>): Promise<string> {
  const base =
    handle
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'user';
  if (!(await taken(base))) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
}
