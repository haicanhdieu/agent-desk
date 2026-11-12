# Contract gaps

Fields the web app needs that the contracts (`packages/contracts`) lack or under-constrain. Resolved in Task 16 after
the backend merges. Each gap is derived client-side or guarded in the web app until then.

| Route                                                             | Field                 | Why                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/connections/:provider/install` (`connections.install`) | `InstallResponse.url` | Typed `z.string()`; should be a constrained absolute URL (`z.url()` with protocol `https`). The app navigates to it with `window.location.assign`, so it re-checks it (`features/setup/location.ts` `safeInstallUrl`: https only, http also in mock/development) and refuses anything else. |
