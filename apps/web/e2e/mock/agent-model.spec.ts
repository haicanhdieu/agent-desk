import { expect, test, type Page } from '@playwright/test';
import {
  BUILTIN,
  FIRST_CREATED_AGENT,
  INVOICER_API,
  INVOICER_API_AGENT,
  ORG,
  OTHER,
  options,
  setAgentModels,
} from './mock';

const GATEWAY = 'https://gateway.harbor-labs.com';
const LOADED_NOTE = "Loaded from the provider. Rules that don't name a model use this one.";
const TYPED_NOTE = "Sent to Claude Code exactly as typed. Rules that don't name a model use this one.";
const REPLACING_TEXTS = [
  'Replaced when you save',
  'Credential needed again',
  'The API address changed. A saved credential is only sent to the address it was saved with, so paste it again for the new one.',
];

const open = async (page: Page) => page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/agent`);
const modelSelect = (page: Page) => page.getByLabel('Default model');
const modelNameInput = (page: Page) => page.getByLabel('Model name');
const addressInput = (page: Page) => page.getByLabel('API address');

/**
 * Opens Desk → Agent & settings of an agent that truly has no credential: the project the setup wizard creates in
 * step 1 (the seeded agents all have one). Only client-side navigation, so the store is not reseeded: wizard step 1,
 * back to the project list, the new project, its Agent & settings. Pair it with `FIRST_CREATED_AGENT` in `setAgentModels`.
 */
async function openAgentWithoutCredential(page: Page) {
  await page.goto(`/o/${ORG}/projects`);
  await page.getByRole('link', { name: 'New project' }).click();
  await page.getByRole('radio', { name: 'dev/demo' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Add the Claude credential', level: 1 })).toBeVisible();
  await page.goBack();
  await page.goBack();
  await page.getByRole('link', { name: 'demo', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Agent & settings' }).click();
  await expect(page.getByRole('heading', { name: 'Agent & settings', level: 1 })).toBeVisible();
}

/** A client-side round trip: a reload would reseed the mock store, this re-reads the saved agent. */
async function leaveAndReturn(page: Page) {
  await page.getByRole('link', { name: 'Routing rules' }).click();
  await expect(page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Agent & settings' }).click();
  await expect(page.getByRole('heading', { name: 'Agent & settings', level: 1 })).toBeVisible();
}

/**
 * Saves the default model through the screen, comes back to it, and waits for the saved value to show: the screen
 * has no save message, so the re-read agent is the proof that the save went through.
 */
async function saveDefaultModel(
  page: Page,
  pick: (page: Page) => Promise<unknown>,
  expectSaved: (page: Page) => Promise<void>,
) {
  await pick(page);
  await page.getByRole('button', { name: 'Save agent' }).click();
  await expect(page.getByRole('button', { name: 'Save agent' })).toBeEnabled();
  await leaveAndReturn(page);
  await expectSaved(page);
}

const expectSelected = (id: string) => (page: Page) => expect(modelSelect(page)).toHaveValue(id);
const expectTyped = (value: string) => async (page: Page) => {
  await expect(modelSelect(page).locator('option:checked')).toHaveText(OTHER);
  await expect(modelNameInput(page)).toHaveValue(value);
};

/** Opens the credential replace panel, pastes a token and tests-and-replaces (saves the typed address with it). */
async function replaceCredential(page: Page, token: string) {
  if (!(await page.getByLabel('New token', { exact: true }).isVisible())) {
    await page.getByRole('button', { name: 'Replace', exact: true }).click();
  }
  await page.getByLabel('New token', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Test and replace' }).click();
  await expect(page.getByLabel('New token', { exact: true })).toHaveCount(0);
}

const live = (ids: string[]) => ({ [INVOICER_API_AGENT]: { kind: 'live' as const, ids } });
const fallback = (
  reason: 'no_credential' | 'unreachable' | 'rejected' | 'empty' | 'disabled',
): Record<string, { kind: 'fallback'; reason: typeof reason }> => ({
  [INVOICER_API_AGENT]: { kind: 'fallback', reason },
});

test.describe('BR-1 Default model dropdown lists the provider models', () => {
  test("TC-1.1 the provider's models show in its order, then Other model…, with the loaded note", async ({ page }) => {
    await setAgentModels(page, live(['model-b', 'model-a', 'model-c']));
    await open(page);
    // The seeded default model (opus) is not in this list, so the screen would show Other model… and its typed note
    // (BR-5). Save a listed model first, as a member whose default is one of the provider's models.
    await saveDefaultModel(page, (p) => modelSelect(p).selectOption('model-b'), expectSelected('model-b'));
    await expect(options(modelSelect(page))).toHaveText(['model-b', 'model-a', 'model-c', OTHER]);
    await expect(page.getByText(LOADED_NOTE)).toBeVisible();
  });

  test('TC-1.2 opus, sonnet and haiku are not offered and no fallback note is shown', async ({ page }) => {
    await setAgentModels(page, live(['model-b', 'model-a', 'model-c']));
    await open(page);
    await expect(options(modelSelect(page))).toHaveText(['model-b', 'model-a', 'model-c', OTHER]);
    for (const name of BUILTIN) await expect(modelSelect(page).locator(`option[value="${name}"]`)).toHaveCount(0);
    await expect(page.getByText('Showing the standard names.')).toHaveCount(0);
  });
});

test.describe('BR-2 the list falls back to the standard names with a reason', () => {
  const expectFallbackWithoutError = async (page: Page, note: string | RegExp) => {
    await expect(options(modelSelect(page))).toHaveText([...BUILTIN, OTHER]);
    await expect(page.getByText(note)).toBeVisible();
    await expect(page.getByText('The model list could not be loaded. You can still type a model name.')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(modelSelect(page)).not.toHaveAttribute('aria-invalid', 'true');
  };

  test('TC-2.1 an agent with no credential shows the standard names and the save-a-credential note, no error state', async ({
    page,
  }) => {
    await setAgentModels(page, { [FIRST_CREATED_AGENT]: { kind: 'fallback', reason: 'no_credential' } });
    await openAgentWithoutCredential(page);
    await expect(page.getByText(/^Set .* by /)).toHaveCount(0);
    await expectFallbackWithoutError(
      page,
      "Showing the standard names. Save a credential to load the provider's list.",
    );
  });

  const cases = [
    ['TC-2.2', 'unreachable', /Showing the standard names\..*could not be loaded/],
    ['TC-2.3', 'rejected', /Showing the standard names\..*did not accept the saved credential/],
    ['TC-2.4', 'empty', /Showing the standard names\..*returned no models/],
  ] as const;
  for (const [id, reason, note] of cases) {
    test(`${id} the standard names and a note for "${reason}" show, with no error state`, async ({ page }) => {
      await setAgentModels(page, fallback(reason));
      await open(page);
      await expectFallbackWithoutError(page, note);
    });
  }
});

test.describe('BR-3 the fallback note shows only the address host', () => {
  test('TC-3.1 the note names gateway.harbor-labs.com only, without the path or https://', async ({ page }) => {
    await setAgentModels(page, fallback('unreachable'));
    await open(page);
    await addressInput(page).fill(`${GATEWAY}/v1/anthropic`);
    await replaceCredential(page, 'sk-test-secret-123');
    await leaveAndReturn(page);
    await expect(addressInput(page)).toHaveValue(`${GATEWAY}/v1/anthropic`);
    const note = page.getByText(/Showing the standard names\./);
    await expect(note).toHaveText(
      'Showing the standard names. The model list at gateway.harbor-labs.com could not be loaded.',
    );
    await expect(note).not.toContainText('/v1/anthropic');
    await expect(note).not.toContainText('https://');
  });

  test('TC-3.2 neither the credential nor provider text appears on the page; the note names only the host', async ({
    page,
  }) => {
    await setAgentModels(page, {
      [INVOICER_API_AGENT]: {
        kind: 'fallback',
        reason: 'rejected',
        providerText: 'invalid x-api-key sk-test-secret-123',
      },
    });
    await open(page);
    // The token is pasted through the screen, so it really is the saved credential of this agent.
    await addressInput(page).fill(`${GATEWAY}/v1/anthropic`);
    await replaceCredential(page, 'sk-test-secret-123');
    await leaveAndReturn(page);
    await expect(addressInput(page)).toHaveValue(`${GATEWAY}/v1/anthropic`);

    const note = page.getByText(/Showing the standard names\./);
    await expect(note).toHaveText(
      'Showing the standard names. The provider at gateway.harbor-labs.com did not accept the saved credential.',
    );
    await expect(note).not.toContainText('/v1/anthropic');
    await expect(note).not.toContainText('https://');

    // The whole page, as seen and as in the DOM, and every input value. The token check is real (it was typed into
    // the screen). The provider-text check proves that nothing from the mocked response can reach the page: the
    // client's parse of the answer already drops the extra `error` field, which contract.test.ts proves.
    const seen = await page.locator('body').innerText();
    const dom = await page.locator('body').textContent();
    const values = await page
      .locator('input')
      .evaluateAll((els) => els.flatMap((el) => (el instanceof HTMLInputElement ? [el.value] : [])));
    for (const where of [seen, dom ?? '', values.join('\n')]) {
      expect(where).not.toContain('sk-test-secret-123');
      expect(where).not.toContain('invalid x-api-key');
    }
  });

  test('TC-3.3 with no address the note says why without naming any host', async ({ page }) => {
    await setAgentModels(page, fallback('unreachable'));
    await open(page);
    const note = page.getByText(/Showing the standard names\./);
    // The plan fixes this wording (Agent call for `unreachable` without an address; spec Q1 leaves it open).
    await expect(note).toHaveText('Showing the standard names. The model list could not be loaded.');
    await expect(note).not.toContainText(/https?:\/\//);
    await expect(note).not.toContainText(/\bat\s+\S+\.\S+/);
  });
});

test.describe('BR-4 Other model… shows a text input', () => {
  test('TC-4.1 picking Other model… shows the text input and its note', async ({ page }) => {
    await setAgentModels(page, fallback('disabled'));
    await open(page);
    await saveDefaultModel(page, (p) => modelSelect(p).selectOption('sonnet'), expectSelected('sonnet'));
    await expect(modelSelect(page)).toHaveValue('sonnet');
    await modelSelect(page).selectOption({ label: OTHER });
    await expect(modelNameInput(page)).toBeVisible();
    await expect(page.getByText(TYPED_NOTE)).toBeVisible();
  });

  test('TC-4.2 picking haiku hides the input and its note', async ({ page }) => {
    await setAgentModels(page, fallback('disabled'));
    await open(page);
    await saveDefaultModel(page, (p) => modelSelect(p).selectOption('sonnet'), expectSelected('sonnet'));
    await modelSelect(page).selectOption({ label: OTHER });
    await modelNameInput(page).fill('my-model');
    await modelSelect(page).selectOption('haiku');
    await expect(modelSelect(page)).toHaveValue('haiku');
    await expect(modelNameInput(page)).toHaveCount(0);
    await expect(page.getByText(TYPED_NOTE)).toHaveCount(0);
  });

  test('TC-4.3 no text input shows while a listed model is selected', async ({ page }) => {
    await setAgentModels(page, fallback('disabled'));
    await open(page);
    await saveDefaultModel(page, (p) => modelSelect(p).selectOption('sonnet'), expectSelected('sonnet'));
    await expect(modelSelect(page)).toHaveValue('sonnet');
    await expect(modelNameInput(page)).toHaveCount(0);
  });
});

test.describe('BR-5 a saved model outside the list shows under Other model…', () => {
  const dated = ['claude-opus-x-20260101', 'claude-sonnet-x-20260101'];

  test('TC-5.1 a typed saved model shows in the input with Other model… selected', async ({ page }) => {
    await setAgentModels(page, live(dated));
    await open(page);
    await saveDefaultModel(
      page,
      async (p) => {
        await modelSelect(p).selectOption({ label: OTHER });
        await modelNameInput(p).fill('vendor/model-1');
      },
      expectTyped('vendor/model-1'),
    );
  });

  test('TC-5.2 sonnet saved while the list has only dated ids shows under Other model…', async ({ page }) => {
    await setAgentModels(page, live(dated));
    await open(page);
    await saveDefaultModel(
      page,
      async (p) => {
        await modelSelect(p).selectOption({ label: OTHER });
        await modelNameInput(p).fill('sonnet');
      },
      expectTyped('sonnet'),
    );
  });

  test('TC-5.3 a saved model that is in the list is selected with no text input', async ({ page }) => {
    await setAgentModels(page, live(dated));
    await open(page);
    await saveDefaultModel(
      page,
      (p) => modelSelect(p).selectOption('claude-sonnet-x-20260101'),
      expectSelected('claude-sonnet-x-20260101'),
    );
    await expect(modelSelect(page).locator('option:checked')).toHaveText('claude-sonnet-x-20260101');
    await expect(modelNameInput(page)).toHaveCount(0);
  });
});

test.describe('BR-9 loading and error states still allow a typed model', () => {
  test('TC-9.1 while the list loads, the loading state shows and a name can be typed under Other model…', async ({
    page,
  }) => {
    await setAgentModels(page, { [INVOICER_API_AGENT]: { kind: 'pending' } });
    await open(page);
    await expect(page.getByText('Loading models…')).toBeVisible();
    await modelSelect(page).selectOption({ label: OTHER });
    await modelNameInput(page).fill('my-model');
    await expect(modelNameInput(page)).toHaveValue('my-model');
    await expect(page.getByText('Loading models…')).toBeVisible();
  });

  test('TC-9.2 when the list request fails, the error state shows and my-model can be typed', async ({ page }) => {
    await setAgentModels(page, { [INVOICER_API_AGENT]: { kind: 'error' } });
    await open(page);
    await expect(page.getByText('The model list could not be loaded. You can still type a model name.')).toBeVisible();
    await expect(modelSelect(page).locator('option', { hasText: OTHER })).toHaveCount(1);
    await modelSelect(page).selectOption({ label: OTHER });
    await modelNameInput(page).fill('my-model');
    await expect(modelNameInput(page)).toHaveValue('my-model');
  });
});

test.describe('BR-10 the dropdown shows each model once, in the provider order', () => {
  test('TC-10.1 the options follow the provider order, each once, then Other model…', async ({ page }) => {
    await setAgentModels(page, live(['m-5', 'm-1', 'm-4', 'm-2', 'm-3']));
    await open(page);
    await expect(options(modelSelect(page))).toHaveText(['m-5', 'm-1', 'm-4', 'm-2', 'm-3', OTHER]);
  });

  test('TC-10.2 all 500 ids are options once each in order, then Other model…', async ({ page }) => {
    const all = Array.from({ length: 500 }, (_, i) => `m-${i + 1}`);
    await setAgentModels(page, live(all));
    await open(page);
    await expect(options(modelSelect(page))).toHaveText([...all, OTHER]);
  });
});

test.describe('BR-13 editing the address switches the credential to its replacing state', () => {
  test("TC-13.1 typing an address shows the replacing texts and the 'Changed from Anthropic's default' note", async ({
    page,
  }) => {
    await open(page);
    await addressInput(page).fill(GATEWAY);
    for (const text of REPLACING_TEXTS) await expect(page.getByText(text, { exact: true })).toBeVisible();
    await expect(
      page.getByText("Changed from Anthropic's default. It is saved together with the new credential below."),
    ).toBeVisible();
  });

  test('TC-13.2 with the address untouched, no replacing text shows and the credential is in its set state', async ({
    page,
  }) => {
    await open(page);
    await expect(page.getByText(/^Set .* by .*Hidden for good after saving\./)).toBeVisible();
    for (const text of REPLACING_TEXTS) await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  });

  test('TC-13.3 clearing a saved address shows the credential needed again', async ({ page }) => {
    await open(page);
    await addressInput(page).fill(GATEWAY);
    await replaceCredential(page, 'sk-test-token');
    await leaveAndReturn(page);
    await expect(addressInput(page)).toHaveValue(GATEWAY);
    await expect(page.getByText('Credential needed again', { exact: true })).toHaveCount(0);

    await addressInput(page).fill('');
    await expect(page.getByText('Credential needed again', { exact: true })).toBeVisible();
  });
});

test.describe('BR-17 saving a credential or address reloads the model list', () => {
  test('TC-17.1 after saving a credential, the list shows the new models without a reload', async ({ page }) => {
    await setAgentModels(page, {
      [FIRST_CREATED_AGENT]: {
        kind: 'live',
        ids: ['model-x', 'model-y'],
        beforeCredentialSave: { kind: 'fallback', reason: 'no_credential' },
      },
    });
    await openAgentWithoutCredential(page);
    await expect(page.getByText(/^Set .* by /)).toHaveCount(0);
    await expect(options(modelSelect(page))).toHaveText([...BUILTIN, OTHER]);
    await replaceCredential(page, 'sk-new-token');
    await expect(options(modelSelect(page))).toHaveText(['model-x', 'model-y', OTHER]);
    await expect(page.getByText('Showing the standard names.')).toHaveCount(0);
  });

  test('TC-17.2 after an address change and a new token, the list comes from the new address', async ({ page }) => {
    await setAgentModels(page, {
      [INVOICER_API_AGENT]: { kind: 'live', ids: ['model-a'], idsByBaseUrl: { [GATEWAY]: ['model-g1', 'model-g2'] } },
    });
    await open(page);
    await expect(options(modelSelect(page))).toHaveText(['model-a', OTHER]);
    await addressInput(page).fill(GATEWAY);
    await replaceCredential(page, 'sk-new-token');
    await expect(options(modelSelect(page))).toHaveText(['model-g1', 'model-g2', OTHER]);
    await expect(modelSelect(page).locator('option[value="model-a"]')).toHaveCount(0);
  });
});
