/** The link an invitee opens: `<origin>/invitations/<id>`. The id is a UUID, so it needs no escaping. */
export function invitationUrl(id: string, origin: string = window.location.origin): string {
  return `${origin}/invitations/${id}`;
}

/** Writes `text` to the clipboard. False when the browser refuses or has no clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
