# 0028. Data lists use offset pages with a total

- Status: Proposed
- Date: 2026-11-19
- Source: issue #146; [shared pagination design](../superpowers/specs/2026-11-19-shared-pagination-design.md)

## Context

The convention docs say every list paginates with a keyset cursor and never uses `OFFSET`. That gives Previous/Next
only: no total, no "Page 3 of 50", no jump to a page. A project with 1000 runs can only be walked 20 or 100 rows at a
time, one click after another. The people who use the lists asked for numbered pages and a count.

## Decision

- Every data list (Runs, Needs you, Ignored, Projects, Rules, Skills, setup version history) uses offset pages with a
  total.
- API rule: `page` is an integer ≥ 1 (default 1, max 2147483647); `pageSize` is an integer 1–100 (default 20). The
  response is `{ items, page, pageSize, total }`. A page past the end is 200 with `items: []` and the real `total`.
- Every paged query has a fixed `ORDER BY` that ends in a unique column. `total` comes from a `count(*)` with the same
  `WHERE`, run in the same `withOrg` transaction (not a window function).
- Readers that need the whole set read page 1 with `pageSize=100` in one request.
- The contract helpers (`PageQuery`, `pageOf`, `pageWindow`, `toPage`, `slicePage`, `pageRange`) live in
  `packages/contracts` and have no framework imports.

## Alternatives considered

| Alternative                           | Why rejected                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Keyset cursor with Previous/Next only | Stable and cheap at any depth, but cannot jump to a page or say how many pages there are          |
| "Load more" / infinite scroll         | Simplest UI, but the list grows long again after a few clicks, which brings back the drawing cost |

## Consequences

- Rows inserted while someone pages shift later pages by one, so a row can show twice or be skipped. This is accepted.
- Deep pages cost more, because the database still walks the skipped rows. `pageSize` is capped at 100 and `page` at 2147483647.
- No new index: `runs` and ignored events already have indexes that match the list orders.

## Links

- [Backend conventions](../conventions/backend.md) §11
- [Database conventions](../conventions/database.md) §8
- [Frontend conventions](../conventions/frontend.md) §3
