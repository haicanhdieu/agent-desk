# After the merge

`.github/workflows/dev-plan-sync.yml` runs `dev-plan.mjs sync --commit <sha>` on `main`. For a merged PR with the `dev-plan` label it finds the issue (the spec's `source=issue#<n>`, else an issue whose body holds `<!-- dev-plan:id=<slug> -->`, else it creates one), rewrites the one block between `<!-- dev-plan:begin … -->` and `<!-- dev-plan:end -->` when the versions in it differ from the files, and comments the issue link on the PR. Same versions: nothing is written. Text outside the block is never touched.

A block that holds a higher `rev` than the files (an old run started again) is left alone, and an issue can hold the blocks of several slugs. A created issue gets the labels `dev-plan` and `enhancement`.

Then `/dev-build <n>` builds from the linked spec and plan.

By hand, for a sync CI missed: on an up-to-date `main`, `dev-plan.mjs sync --files <spec> <plan> --dry-run`, read it, then run it without `--dry-run`. Never edit the block or the issue link by hand.
