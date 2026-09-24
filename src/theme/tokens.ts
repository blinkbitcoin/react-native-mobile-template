// Monochrome on purpose: this is a development skeleton, so the palette is
// black, white and a neutral gray ramp for hierarchy. `danger` is the one hue,
// reserved for errors. A real app replaces this file with its brand.
export const palette = {
  white: '#ffffff',
  black: '#0a0a0a',
  gray50: '#fafafa',
  gray200: '#e5e5e5',
  gray400: '#a3a3a3',
  gray500: '#737373',
  gray800: '#262626',
  gray900: '#171717',
  red600: '#dc2626',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radii = { sm: 6, md: 10, lg: 14 } as const;
export const typography = { title: 28, body: 16, caption: 13 } as const;

export type Scheme = 'light' | 'dark';

export const colorsByScheme = {
  light: {
    background: palette.white,
    surface: palette.gray50,
    text: palette.black,
    muted: palette.gray500,
    // The filled button: ink on paper, inverted in the dark scheme.
    primary: palette.black,
    onPrimary: palette.white,
    danger: palette.red600,
    border: palette.gray200,
  },
  dark: {
    background: palette.black,
    surface: palette.gray900,
    text: palette.white,
    muted: palette.gray400,
    primary: palette.white,
    onPrimary: palette.black,
    danger: palette.red600,
    border: palette.gray800,
  },
} as const;

export type Theme = {
  scheme: Scheme;
  colors: (typeof colorsByScheme)[Scheme];
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
};

export function buildTheme(scheme: Scheme): Theme {
  return { scheme, colors: colorsByScheme[scheme], spacing, radii, typography };
}
