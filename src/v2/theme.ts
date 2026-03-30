/**
 * v2 Shared style constants — used across all v2 pages
 * Gradient bg, white cards, brand-blue depth, hover lifts
 */

export const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export const COLORS = {
  brand:        "#0076B6",
  brandLight:   "#0088cc",
  brandMuted:   "rgba(0,118,182,0.10)",
  border:       "#D8E4EF",
  borderStrong: "#B8CFDF",
  pageBg:       "linear-gradient(145deg, #e8f4fb 0%, #f0f6ff 40%, #eaf1f8 100%)",
  cardBg:       "#ffffff",
  cardHeaderBg: "linear-gradient(180deg, #f7fbff 0%, #ffffff 100%)",
  textPrimary:  "#141820",
  textMuted:    "#6E7580",
  textSubtle:   "#9BA3AE",
  success:      "#16a34a",
  successBg:    "#f0fdf4",
  successBorder:"#bbf7d0",
  danger:       "#dc2626",
  dangerBg:     "#fff5f5",
  dangerBorder: "#fca5a5",
  amber:        "#d97706",
  amberBg:      "rgba(245,158,11,0.06)",
  amberBorder:  "rgba(245,158,11,0.35)",
};

export const SHADOWS = {
  card:    "0 4px 6px -1px rgba(0,0,0,0.07), 0 10px 30px -5px rgba(0,80,140,0.10)",
  cardHover: "0 8px 24px rgba(0,80,140,0.14)",
  btn:     "0 2px 6px rgba(0,80,140,0.07)",
  btnHover:"0 4px 16px rgba(0,80,140,0.12)",
  primary: "0 4px 14px rgba(0,118,182,0.35)",
  danger:  "0 2px 6px rgba(220,38,38,0.08)",
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
  boxShadow: "0 2px 8px rgba(0,80,140,0.06)",
};

/** Card header gradient strip */
export const cardHeaderStyle: React.CSSProperties = {
  padding: "1.25rem 1.5rem",
  borderBottom: `1px solid #E8EEF5`,
  background: COLORS.cardHeaderBg,
};

/** Section title inside card header */
export const cardTitleStyle: React.CSSProperties = {
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
  background: `linear-gradient(135deg, ${COLORS.brandLight} 0%, ${COLORS.brand} 100%)`,
  color: "#fff",
  fontSize: "0.9375rem",
  fontWeight: 600,
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
  background: "#fff",
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
  background: `linear-gradient(135deg, #22c55e 0%, #16a34a 100%)`,
  color: "#fff",
  fontSize: "0.9375rem",
  fontWeight: 600,
  border: "none",
  borderRadius: 10,
  cursor: "pointer",
  boxShadow: "0 4px 14px rgba(22,163,74,0.30)",
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
  background: "#ffffff",
  border: `1px solid ${COLORS.border}`,
  borderLeft: `3px solid ${COLORS.brand}`,
  borderRadius: 10,
  cursor: "pointer",
  textAlign: "left",
  transition: "box-shadow 0.15s, transform 0.15s, background 0.15s",
  boxShadow: "0 2px 8px rgba(0,80,140,0.06)",
};

/** Input field */
export const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#fff",
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
  border: `1px solid rgba(0,118,182,0.2)`,
};

/** Page content scroll area (used inside AppShell) */
export const pageContentStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "1.5rem",
};