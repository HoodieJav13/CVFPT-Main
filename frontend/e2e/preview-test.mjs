import { test as base, expect } from '@playwright/test';

// The preview mock answers unknown routes with a synthetic 404 that never
// touches the network, so network listeners cannot see it. The mock writes
// this marker to the console instead; this fixture fails any test that
// produced one, even when the screen caught and hid the error.
const MISSING_MOCK_MARKER = 'cvf-preview/missing-mock';
// A save the mock served that "Fail next save" does not know about.
const UNLISTED_SAVE_MARKER = 'cvf-preview/unlisted-save';

export const test = base.extend({
  allowMissingMocks: [false, { option: true }],
  missingMocks: [async ({ context, allowMissingMocks }, use) => {
    const hits = [];
    const unlistedSaves = [];
    const onConsole = (message) => {
      const text = message.text();
      if (text.startsWith(MISSING_MOCK_MARKER)) hits.push(text.slice(MISSING_MOCK_MARKER.length).trim());
      if (text.startsWith(UNLISTED_SAVE_MARKER)) unlistedSaves.push(text.slice(UNLISTED_SAVE_MARKER.length).trim());
    };
    context.on('console', onConsole);
    await use(hits);
    context.off('console', onConsole);
    if (unlistedSaves.length) {
      throw new Error(`Preview save routes missing from PREVIEW_SAVE_ROUTES:\n${[...new Set(unlistedSaves)].map((hit) => `  ${hit}`).join('\n')}\n`
        + 'Add each one to PREVIEW_SAVE_ROUTES in frontend/src/lib/previewMode.js so "Fail next save" can apply to it.');
    }
    if (!allowMissingMocks && hits.length) {
      throw new Error(`Preview routes with no mock were requested:\n${[...new Set(hits)].map((hit) => `  ${hit}`).join('\n')}\n`
        + 'Add a mock in frontend/src/lib/previewMode.js, or list the route in PREVIEW_UNSUPPORTED with a reason.');
    }
  }, { auto: true }],
});

export { expect };

export async function usePreviewRole(page, role, clientId = 'client_sarah') {
  await page.addInitScript(({ selectedRole, selectedClient }) => {
    localStorage.setItem('cvf_preview_role', selectedRole);
    localStorage.setItem('cvf_preview_client_id', selectedClient);
  }, { selectedRole: role, selectedClient: clientId });
}

// Sends a request through the app's own axios instance (the one the preview
// adapter is installed on). Resolves for failures too.
export async function callPreviewApi(page, method, path, body) {
  return page.evaluate(async ({ requestMethod, requestPath, requestBody }) => {
    const { api } = await import('/src/lib/api.js');
    try {
      const response = await api.request({ method: requestMethod, url: requestPath, data: requestBody });
      return { status: response.status, data: response.data };
    } catch (error) {
      return { status: error?.response?.status ?? null, data: error?.response?.data ?? null };
    }
  }, { requestMethod: method, requestPath: path, requestBody: body });
}
