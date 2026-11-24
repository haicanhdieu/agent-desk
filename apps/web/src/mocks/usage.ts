import type { UsageCellView } from './types';

/** Runs list Usage cell fixtures (display-ready strings, as the mapper will produce them). */
export const usageCellValue: UsageCellView = {
  text: '48.2k · ~$0.42',
  title: '48,213 tokens in total, estimated cost $0.42, 1 model',
  srSuffix: ' tokens, estimated cost',
};
export const usageCellPartial: UsageCellView = {
  text: '61.2k · ~$0.42+',
  title: '61,173 tokens in total, estimated cost at least $0.42, 2 models',
  srSuffix: ' tokens, estimated cost, at least',
};
export const usageCellNoCost: UsageCellView = {
  text: '12.8k · —',
  title: '12,840 tokens in total, no estimated cost, 1 model',
  srSuffix: ' tokens, no estimated cost',
};
export const usageCellSubCent: UsageCellView = {
  text: '2.1k · ~<$0.01',
  title: '2,104 tokens in total, estimated cost under $0.01, 1 model',
  srSuffix: ' tokens, estimated cost',
};
export const usageCellNone: UsageCellView = { text: '—', title: 'No usage data', srSuffix: 'No usage data' };

const cell = (text: string, tokens: string, cost: string): UsageCellView => ({
  text,
  title: `${tokens} tokens in total, estimated cost ${cost}, 1 model`,
  srSuffix: ' tokens, estimated cost',
});
/** Cells of the RunsUsage and RunsPageLoadingUsage boards. */
export const usageCellRun62 = cell('31.9k · ~$0.19', '31,922', '$0.19');
export const usageCellRun61 = cell('26.6k · ~$0.24', '26,572', '$0.24');
export const usageCellRun54 = cell('1.2M · ~$2.31', '1,204,118', '$2.31');
export const usageCellPage2 = cell('9.1k · ~$0.07', '9,100', '$0.07');
export const usageCellPage3 = cell('3.4k · ~$0.02', '3,400', '$0.02');
