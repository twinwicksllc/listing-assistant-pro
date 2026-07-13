/**
 * v2 Shared style constants — used across all v2 pages
 * "Ember Standard": amber accent, genuine light/dark via CSS variables.
 *
 * All colors reference the --v2-* CSS variables defined in theme.css so a single
 * source of truth drives both themes. The tokens flip automatically when
 * `html.light` is toggled by ThemeProvider.
 */

export const FONT =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export const DISPLAY_FONT =
  "'Space Grotesk', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

/** Color tokens — all resolve through CSS variables (theme-aware). */
export const COLORS = {
  brand:        "hsl(var(--v2-primary))",
  brandLight:   "hsl(var(--v2-primary-hover))",
  brandMuted:   "hsl(var(--v2-primary) / 0.12)",
  border:       "hsl(var(--v2-border))",
  borderStrong: "hsl(var(--v2-border-strong))",
  pageBg:       "hsl(var(--v2-bg))",
  cardBg:       "hsl(var(--v2-card))",
  cardHeaderBg: "hsl(var(--v2-bg-subtle))",
  textPrimary:  "hsl(var(--v2-fg))",
  textMuted:    "hsl(var(--v2-fg-muted))",
  textSubtle:   "hsl(var(--v2-fg-subtle))",
  success:      "hsl(var(--v2-success))",
  successBg:    "hsl(var(--v2-success-light))",
  successBorder:"hsl(var(--v2-success) / 0.4)",
  danger:       "hsl(var(--v2-danger))",
  dangerBg:     "hsl(var(--v2-danger-light))",
  dangerBorder: "hsl(var(--v2-danger) / 0.45)",
  amber:        "hsl(var(--v2-warning))",
  amberBg:      "hsl(var(--v2-warning-light))",
  amberBorder:  "hsl(var(--v2-warning) / 0.4)",
};

export const SHADOWS = {
  card:      "var(--v2-card-shadow-md)",
  cardHover: "var(--v2-card-shadow-lg)",
  btn:       "var(--v2-card-shadow)",
  btnHover:  "var(--v2-card-shadow-md)",
  primary:   "0 4px 14px hsl(var(--v2-primary) / 0.35)",
  danger:    "0 2px 6px hsl(var(--v2-danger) / 0.2)",
};

/** Full-page wrapper */
export const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: COLORS.pageBg,
  backgroundAttachment: "fixed",
  fontFamily: FONT,
};

/** White card with brand top accent */
export const cardStyle: React.CSSProperties = {
  background: COLORS.cardBg,
  border: `1px solid ${COLORS.border}`,
  borderTop: `3px solid ${COLORS.brand}`,
  borderRadius: 16,
  boxShadow: SHADOWS.card,
  overflow: "hidden",
};

/** Card without top accent (for inner/nested cards) */
export const cardInnerStyle: React.CSSProperties = {
  background: COLORS.cardBg,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 12,
  boxShadow: SHADOWS.btn,
};

/** Card header gradient strip */
export const cardHeaderStyle: React.CSSProperties = {
  padding: "1.25rem 1.5rem",
  borderBottom: `1px solid ${COLORS.border}`,
  background: COLORS.cardHeaderBg,
};

/** Section title inside card header */
export const cardTitleStyle: React.CSSProperties = {
  fontFamily: DISPLAY_FONT,
  fontSize: "1rem",
  fontWeight: 700,
  color: COLORS.textPrimary,
  margin: 0,
};

/** Primary CTA button */
export const btnPrimaryStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.5rem",
  padding: "0.75rem 1.5rem",
  background: COLORS.brand,
  color: "hsl(var(--v2-primary-fg))",
  fontSize: "0.9375rem",
  fontWeight: 700,
  border: "none",
  borderRadius: 10,
  cursor: "pointer",
  boxShadow: SHADOWS.primary,
  transition: "opacity 0.15s, box-shadow 0.15s, transform 0.15s",
};

/** Outline / secondary button */
export const btnOutlineStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.5rem",
  padding: "0.625rem 1.25rem",
  background: COLORS.cardBg,
  color: COLORS.brand,
  fontSize: "0.9375rem",
  fontWeight: 600,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
  cursor: "pointer",
  boxShadow: SHADOWS.btn,
  transition: "box-shadow 0.15s, background 0.15s",
};

/** Danger button */
export const btnDangerStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.5rem",
  padding: "0.625rem 1.25rem",
  background: COLORS.dangerBg,
  color: COLORS.danger,
  fontSize: "0.9375rem",
  fontWeight: 600,
  border: `1px solid ${COLORS.dangerBorder}`,
  borderRadius: 10,
  cursor: "pointer",
  boxShadow: SHADOWS.danger,
  transition: "box-shadow 0.15s, background 0.15s",
};

/** Success / green button */
export const btnSuccessStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.5rem",
  padding: "0.75rem 1.5rem",
  background: COLORS.success,
  color: "#fff",
  fontSize: "0.9375rem",
  fontWeight: 600,
  border: "none",
  borderRadius: 10,
  cursor: "pointer",
  boxShadow: "0 4px 14px hsl(var(--v2-success) / 0.3)",
  transition: "opacity 0.15s, box-shadow 0.15s",
};

/** Row button (clickable list item with chevron) */
export const rowBtnStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem",
  width: "100%",
  padding: "1rem 1.25rem",
  background: COLORS.cardBg,
  border: `1px solid ${COLORS.border}`,
  borderLeft: `3px solid ${COLORS.brand}`,
  borderRadius: 10,
  cursor: "pointer",
  textAlign: "left",
  transition: "box-shadow 0.15s, transform 0.15s, background 0.15s",
  boxShadow: SHADOWS.btn,
};

/** Input field */
export const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "hsl(var(--v2-bg-subtle))",
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  padding: "0.625rem 0.875rem",
  fontSize: "0.9375rem",
  color: COLORS.textPrimary,
  outline: "none",
  transition: "border-color 0.15s, box-shadow 0.15s",
};

/** Label above input */
export const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: COLORS.textMuted,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: "0.375rem",
};

/** Small muted badge/pill */
export const badgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  padding: "0.2rem 0.6rem",
  background: COLORS.brandMuted,
  color: COLORS.brand,
  fontSize: "0.75rem",
  fontWeight: 600,
  borderRadius: 999,
  border: `1px solid hsl(var(--v2-primary) / 0.25)`,
};

/** Page content scroll area (used inside AppShell) */
export const pageContentStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "1.5rem",
};
