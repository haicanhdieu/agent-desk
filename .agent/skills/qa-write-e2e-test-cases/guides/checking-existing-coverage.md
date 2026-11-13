# Checking existing coverage

How to set `existing` on a test case so the project does not get the same test twice.

## What you may open

- `inventory-e2e.txt` in the work directory: every existing e2e suite and test, one `ref` per line (`<file> › <title>`). It is short; read it whole.
- `inventory-lower.txt`: the same for unit, route and API tests. It is long: grep it, never read it whole.
- Never open `inventory.json`. It holds the same refs in a form only the validator needs, and costs about 100k tokens to read.
- Existing spec files under `apps/web/e2e/`, to confirm what a candidate test does.

Nothing else. Unit and integration test bodies, source files, stories and mocks stay closed; for those layers the title is all you use.

## Procedure

For each case:

1. **Search the inventory.** Look through `inventory-e2e.txt` for the scope slug plus case id (`<slug> TC-BR07-01`), then for the key nouns of the case: the screen, the control, the value, the message. Then grep `inventory-lower.txt`, case-insensitive, for the same nouns; one grep with alternatives (`plugin.*name|name.*length`) covers several cases at once.
2. **No plausible match:** `{ "status": "NEW" }`.
3. **An e2e-layer match:** open that spec file and read the test. Then decide:

| What the existing e2e test does                                                            | Status                                                                             |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Reaches the same condition and asserts the same outcome the source requires                | `COVERED` with `ref`                                                               |
| Reaches the condition but asserts less, or asserts the outcome under a different condition | `PARTIAL` with `ref` and `missing` (what it does not check)                        |
| Asserts something the source contradicts                                                   | `NEW`, and add a `note` on the case naming the test that disagrees with the source |
| Only passes through the screen on its way elsewhere                                        | `NEW`                                                                              |

4. **Only a lower-layer match** (unit, route, API test): `PARTIAL` with `ref` and `missing: "covered below e2e only; the end-to-end flow is not exercised"`. A lower-layer test never makes an e2e case `COVERED`.

Copy `ref` exactly: it is the whole line of the inventory file. The validator rejects a ref that is not there.

## The bar for COVERED

A title that mentions the same screen or feature is not coverage. Mark `COVERED` only when you have read the e2e test and it proves this case's condition and outcome. When in doubt between `COVERED` and `PARTIAL`, choose `PARTIAL`; between `PARTIAL` and `NEW`, choose `NEW`. A duplicate test costs minutes; a rule believed covered that is not costs a bug in production.

An existing test passing does not show the behaviour is right. The source decides what is expected, not the test.
