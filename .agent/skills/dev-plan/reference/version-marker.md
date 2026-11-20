# Version marker and PR marks

## How a dev-plan PR differs from any other PR

Three marks, all set by this skill. The merge sync acts only on the first, so a normal PR that edits a spec or ticks a plan's boxes never touches an issue.

| Mark   | Value                                                     | Read by                             |
| ------ | --------------------------------------------------------- | ----------------------------------- |
| Label  | `dev-plan` on the PR                                      | `dev-plan-sync.yml` (the only gate) |
| Branch | `spec/<slug>`                                             | people, and a re-run of this skill  |
| Marker | `<!-- dev-plan: … -->` on line 1 of the spec and the plan | `check`, `sync`, a re-run           |

## The marker

`stamp` writes line 1 of each file; never type it by hand:

```
<!-- dev-plan: kind=spec id=<slug> rev=2 hash=3f9a1c2e7b04 source=issue#123 -->
<!-- dev-plan: kind=plan id=<slug> rev=1 hash=91be07c4d2aa spec=<spec path> spec-hash=3f9a1c2e7b04 -->
```

`hash` covers the text below the marker (a ticked checkbox counts as unticked, so `dev-build` progress is not a new revision). `rev` goes up only when the hash changes. `check` prints one state per file:

| State       | Means                                          | Do                                                      |
| ----------- | ---------------------------------------------- | ------------------------------------------------------- |
| `clean`     | Text matches its stamp                         | Nothing                                                 |
| `edited`    | Text changed since the stamp                   | `stamp` it, then re-ask the gate that approved it       |
| `stale`     | A plan whose spec changed after it was stamped | Planner updates the plan (phase 6), then `stamp`        |
| `unstamped` | No marker                                      | `stamp` with `--kind` and `--id` (a plan: `--spec` too) |

**Stamp only what the human is about to approve or has just approved.** An approval covers one `rev` and `hash`; name both in every gate ask.
