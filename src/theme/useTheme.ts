import { useContext } from 'react';
import { ThemeContext, ThemePreferenceContext } from './ThemeProvider';

export function useTheme() {
  return useContext(ThemeContext);
}
export function useThemePreference() {
  return useContext(ThemePreferenceContext);
}
