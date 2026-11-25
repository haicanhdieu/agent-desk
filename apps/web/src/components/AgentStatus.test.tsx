import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentStatus } from './AgentStatus';

const tone = (text: string) => screen.getByText(text).parentElement as HTMLElement;

describe('AgentStatus', () => {
  it.each([
    ['ok', 'Ready', 'ok'],
    ['no_credential', 'Needs credential', 'warn'],
    ['not_tested', 'Not tested', 'off'],
    ['rejected', 'Credential rejected', 'err'],
    ['unreachable', "Can't reach address", 'err'],
    ['invalid', "Can't verify", 'warn'],
    ['unsupported', 'Not checkable', 'off'],
    ['testing', 'Testing…', 'off'],
  ])('maps %s to the word %s in the %s tone, with a glyph', (status, text, expected) => {
    const { container } = render(<AgentStatus status={status} />);
    expect(tone(text).className).toContain(expected);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('reads No credential in the neutral off tone, not amber, when the credential is optional', () => {
    render(<AgentStatus status="no_credential" credentialOptional />);
    expect(tone('No credential').className).toContain('off');
    expect(tone('No credential').className).not.toMatch(/warn|idle|late/);
    expect(screen.queryByText('Needs credential')).toBeNull();
  });

  it("shows Can't verify for a status it does not know", () => {
    render(<AgentStatus status="something_new" />);
    expect(screen.getByText("Can't verify")).toBeInTheDocument();
  });

  it('marks Testing as busy', () => {
    const { container } = render(<AgentStatus status="testing" />);
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
  });
});
