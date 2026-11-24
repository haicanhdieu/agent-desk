import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usageCellNoCost, usageCellNone, usageCellPartial, usageCellSubCent, usageCellValue } from '@/mocks/usage';
import { UsageCell } from './UsageCell';

function renderCell(usage?: Parameters<typeof UsageCell>[0]['usage']) {
  const { container } = render(
    <table>
      <tbody>
        <tr>
          <UsageCell usage={usage} />
        </tr>
      </tbody>
    </table>,
  );
  const td = container.querySelector('td');
  if (!td) throw new Error('no cell');
  return td;
}

describe('UsageCell', () => {
  it.each([
    [
      'Value',
      usageCellValue,
      '48.2k · ~$0.42',
      '48,213 tokens in total, estimated cost $0.42, 1 model',
      ' tokens, estimated cost',
    ],
    [
      'Partial',
      usageCellPartial,
      '61.2k · ~$0.42+',
      '61,173 tokens in total, estimated cost at least $0.42, 2 models',
      ' tokens, estimated cost, at least',
    ],
    [
      'NoCost',
      usageCellNoCost,
      '12.8k · —',
      '12,840 tokens in total, no estimated cost, 1 model',
      ' tokens, no estimated cost',
    ],
    [
      'SubCent',
      usageCellSubCent,
      '2.1k · ~<$0.01',
      '2,104 tokens in total, estimated cost under $0.01, 1 model',
      ' tokens, estimated cost',
    ],
  ])('%s shows the text, title and screen reader suffix', (_n, view, text, title, sr) => {
    const td = renderCell(view);
    expect(td.textContent).toBe(`${text}${sr}`);
    expect(td).toHaveAttribute('title', title);
    expect(td.querySelector('.sr-only')?.textContent).toBe(sr);
    expect(td.textContent).not.toMatch(/provider bill|\d{4}/);
    expect(td).not.toHaveAttribute('tabindex');
  });

  it('None and absent show a dash with the no-data title', () => {
    for (const td of [renderCell(usageCellNone), renderCell(undefined)]) {
      expect(td.textContent).toBe('—No usage data');
      expect(td).toHaveAttribute('title', 'No usage data');
      expect(td.querySelector('.sr-only')?.textContent).toBe('No usage data');
    }
  });
});
