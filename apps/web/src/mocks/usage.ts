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
