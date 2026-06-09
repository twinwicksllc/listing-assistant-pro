import { useContext } from "react";
import { ThemeContext } from "./theme-context";
import type { ThemeContextValue, Theme } from "./theme-context";

/** Returns the current theme and a stable toggleTheme callback. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export type { Theme };
