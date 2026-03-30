# V2 UI Redesign — Todo

## Phase 1 — Design System & Shared Components
- [x] Read existing codebase (done in planning)
- [ ] Fix index.html viewport (remove user-scalable=no)
- [ ] Create src/v2/theme.css — white bg, #0076B6 primary, #B0B7BC silver, system font stack, base 16px
- [ ] Create src/v2/components/SideNav.tsx — desktop left sidebar
- [ ] Create src/v2/components/AppShell.tsx — responsive wrapper (sidebar ≥1024px, bottom nav <1024px)

## Phase 2 — Page: /home2
- [ ] Create src/v2/pages/HomePage2.tsx — same logic as HomePage, v2 layout
- [ ] Register /home2 route in App.tsx

## Phase 3 — Page: /settings2
- [ ] Create src/v2/pages/SettingsPage2.tsx — same logic as SettingsPage, v2 layout
- [ ] Register /settings2 route in App.tsx

## Phase 4 — Verify & PR
- [ ] npm run build — confirm 0 errors
- [ ] Commit to feature/v2-ui-redesign branch
- [ ] Push and create PR