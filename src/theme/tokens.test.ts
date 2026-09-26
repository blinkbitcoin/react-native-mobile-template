import { buildTheme, colorsByScheme, palette, radii, spacing, typography } from './tokens';

test('buildTheme pairs a scheme with its colours and the shared scales', () => {
  for (const scheme of ['light', 'dark'] as const) {
    expect(buildTheme(scheme)).toEqual({
      scheme,
      colors: colorsByScheme[scheme],
      spacing,
      radii,
      typography,
    });
  }
});

test('both schemes define the same colour roles, so a component never reads undefined', () => {
  expect(Object.keys(colorsByScheme.dark).sort()).toEqual(Object.keys(colorsByScheme.light).sort());
});

test('the dark scheme inverts ink and paper and keeps the one hue for errors', () => {
  expect(colorsByScheme.light.background).toBe(palette.white);
  expect(colorsByScheme.dark.background).toBe(palette.black);
  expect(colorsByScheme.dark.primary).toBe(colorsByScheme.light.onPrimary);
  expect(colorsByScheme.dark.danger).toBe(colorsByScheme.light.danger);
});

test('every colour is a palette entry', () => {
  const swatches = new Set<string>(Object.values(palette));
  for (const colors of Object.values(colorsByScheme)) {
    for (const value of Object.values(colors)) expect(swatches).toContain(value);
  }
});
