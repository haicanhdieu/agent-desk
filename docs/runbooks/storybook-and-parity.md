# Run Storybook and check visual parity

How to browse the design system and screens in Storybook, and how to compare them screenshot by screenshot with the prototype. The rules (stories required, tokens only, drift recorded) are in [frontend.md](../conventions/frontend.md).

**Applies to:** anyone changing `apps/web/src/{ds,components,screens}`.

## Storybook

```sh
devbox run storybook          # http://localhost:6006
```

It doesn't need the backend. Stories read fixtures from `@/mocks`. Every story is also rendered and axe-checked by `pnpm --filter @agentdesk/web test` (`stories.smoke.test.tsx`).

## Visual parity with the prototype

1. Once only, install Chromium: `devbox run playwright-install`. Or point `PARITY_CHROMIUM` at a Chromium binary you already have.
2. Build Storybook and take the screenshot pairs:

   ```sh
   pnpm --filter @agentdesk/web build-storybook
   devbox run parity
   ```

3. For every board you touched, open `apps/web/parity-out/<Board>.story.png` next to `<Board>.proto.png` and compare them.
4. Fix any drift, or record it with a reason in `design/parity-notes.md`.
5. Attach the relevant pairs to the PR under "Screenshots".

Notes:

- The parity script loads Google Fonts, so it needs network access.
- `parity-out/` and `storybook-static/` are gitignored. Never commit them.
- When you add a new board, update `canvas.json`, `screens/storyIds.ts` and `scripts/parity.mjs` together, or `coverage.test.ts` fails.
