export const palette = {
  white: '#ffffff',
  black: '#0b0b0f',
  gray100: '#f3f4f6',
  gray700: '#374151',
  gray900: '#111827',
  blue600: '#2563eb',
  red600: '#dc2626',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radii = { sm: 4, md: 8, lg: 16 } as const;
export const typography = { title: 24, body: 16, caption: 12 } as const;

export type Scheme = 'light' | 'dark';

export const colorsByScheme = {
  light: {
    background: palette.white,
    surface: palette.gray100,
    text: palette.gray900,
    muted: palette.gray700,
    primary: palette.blue600,
    danger: palette.red600,
    border: palette.gray700,
  },
  dark: {
    background: palette.black,
    surface: palette.gray900,
    text: palette.white,
    muted: palette.gray100,
    primary: palette.blue600,
    danger: palette.red600,
    border: palette.gray100,
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
