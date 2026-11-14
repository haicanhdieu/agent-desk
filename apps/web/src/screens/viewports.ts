/** Artboard sizes used by canvas.json. Ids double as Storybook viewport option keys. */
export const artboards = [
  [1440, 900],
  [1440, 1000],
  [1440, 960],
  [1440, 740],
  [1440, 1320],
  [1280, 800],
] as const;

export const viewportId = (width: number, height: number) => `desktop${width}x${height}`;

/** Storybook 10 `parameters.viewport.options`. */
export const viewportOptions = Object.fromEntries(
  artboards.map(([w, h]) => [
    viewportId(w, h),
    { name: `Desktop ${w}x${h}`, styles: { width: `${w}px`, height: `${h}px` }, type: 'desktop' as const },
  ]),
);

/** Story-level `globals` selecting one of the presets. */
export const viewport = (width: number, height: number) => ({
  viewport: { value: viewportId(width, height), isRotated: false },
});
