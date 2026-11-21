import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText, invitationUrl } from './link';

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const stubClipboard = (writeText: (t: string) => Promise<void>) =>
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

afterEach(() => {
  if (original) Object.defineProperty(navigator, 'clipboard', original);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe('invitationUrl', () => {
  it('builds <origin>/invitations/<id>', () => {
    expect(invitationUrl('abc', 'https://desk.example')).toBe('https://desk.example/invitations/abc');
  });

  it('defaults to the page origin', () => {
    expect(invitationUrl('abc')).toBe(`${window.location.origin}/invitations/abc`);
  });
});

describe('copyText', () => {
  it('writes the text and returns true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    await expect(copyText('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('returns false when writeText rejects', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')));
    await expect(copyText('hello')).resolves.toBe(false);
  });

  it('returns false when there is no clipboard', async () => {
    Reflect.deleteProperty(navigator, 'clipboard');
    await expect(copyText('hello')).resolves.toBe(false);
  });
});
