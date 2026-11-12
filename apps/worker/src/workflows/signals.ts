import { defineSignal } from '@temporalio/workflow';

// Signal names are the literals shared with the api via @agentdesk/core's SIGNAL (workflow code must not import
// core: it pulls in node-only modules). A test asserts the two stay equal.

// Gate signals
export const requestSlot = defineSignal<[string]>('requestSlot');
export const releaseSlot = defineSignal<[string]>('releaseSlot');
export const setLimit = defineSignal<[number]>('setLimit');

// Run signals
export const granted = defineSignal<[]>('granted');
export const turnFinished = defineSignal<[]>('turnFinished');
export const resumed = defineSignal<[]>('resumed');
export const terminalAttached = defineSignal<[]>('terminalAttached');
export const terminalDetached = defineSignal<[]>('terminalDetached');
export const finish = defineSignal<[]>('finish');
export const cancel = defineSignal<[]>('cancel');
