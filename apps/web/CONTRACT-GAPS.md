# Contract gaps

Fields the web app needs that the contracts (`packages/contracts`) lack or under-constrain. Resolved in Task 16 after
the backend merges. Each gap is derived client-side or guarded in the web app until then.

| Route                                                                 | Field                 | Why                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/connections/:provider/install` (`connections.install`)     | `InstallResponse.url` | Typed `z.string()`; should be a constrained absolute URL (`z.url()` with protocol `https`). The app navigates to it with `window.location.assign`, so it re-checks it (`features/setup/location.ts` `safeInstallUrl`: https only, http also in mock/development) and refuses anything else. |
| `GET/PUT /api/projects/:projectId/agent` (`agents.get`, `agents.put`) | idle end timeout      | The Agent & settings board has an editable "End idle runs after" limit, but no contract field carries it (the worker fixes it at 10 min, control-plane spec §5). The app shows 10 (`features/desk/agent.form.ts` `IDLE_END_MINUTES`) and a limits save never sends it.                      |
