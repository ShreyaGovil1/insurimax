# InsuriMax design system: Peacock & Marigold

A light, calm workspace for people deciding cashless claims against a 3-hour clock: TPA adjusters at
office desks, hospital billing staff at a counter, patients on their phones. Every screen answers
"what happens next?" and offers one obvious way forward.

Tokens live in `src/index.css` (`@theme`), so every Tailwind utility below is generated from them.

## Colour roles

| Role | Tokens | Use for |
|---|---|---|
| Ground & surfaces | `ground`, `surface`, `sunken`, `line`, `line-strong` | Page, cards, wells, dividers |
| Ink | `ink`, `ink-2`, `ink-3` (≥4.5:1), `ink-4` (decoration and icons only) | Text, from primary to muted |
| Peacock (brand) | `peacock-50 … 950` | Shell, primary buttons, selection, links, completed progress |
| Marigold (proceed) | `marigold-50 … 800` | **The single next-step action on a screen** (`<Button variant="proceed">`), the current station, flagged line items, SLA under 30 min |
| Leaf | `leaf-*` | Approved, verified, met SLA |
| Sand | `sand-*` | Reduced, queried, warnings |
| Vermilion | `vermilion-*` | Excluded, rejected, breached, destructive |

Rules:
- One marigold button per view. Everything else is `primary`, `secondary` or `ghost`.
- State colours always come with an icon and a label (see `components/common/status.jsx`).
- Amounts use the `figures` utility (tabular numerals); IDs such as claim and policy numbers use `font-mono`.

## Type

One family, **Anek Latin** (Ek Type), loaded in `index.html`. It covers ₹ and has sister
families for Devanagari, Tamil, Bengali and other Indian scripts if the patient pages are localised.
Sizes: `text-tiny` 12, `text-small` 13, `text-sm` 14, `text-body` 15 (default), headings 18–30, figures up to 44.

## Shape, depth, motion

- Cards: `rounded-card` (14px) + `shadow-card`; fields and buttons: `rounded-field` (10px).
- Raised layers (popovers, the next-step spotlight, explanation panel): `shadow-raised`; dialogs: `shadow-dialog`.
- Motion is 150–300 ms with `ease-out-strong`; entrances use `animate-rise`. Dialogs scale in from 0.97,
  toasts slide in, and the route rail fills once on load. Everything respects `prefers-reduced-motion`.

## Signature pieces

- **Route rail** (`common/JourneyRail.jsx`): the claim's five stations (Draft → Documents → Submitted →
  AI adjudication → Decision) drawn like a metro line, with a marigold beacon on the current station.
  `MiniJourney` is the four-stop version used in tables.
- **Next-step bar** (`adjudication/NextStepBar.jsx`): the rail plus the one action for this role and state.
- **Decision stamp** (`common/DecisionStamp.jsx`): the ink stamp shown once a decision is locked.
- **Guilloche** (`common/Guilloche.jsx`): security-print linework, used only on the sign-in panel,
  the patient tracker header and the compliance record.

## Building blocks

`ui/`: `Button` (`primary`, `proceed`, `secondary`, `ghost`, `danger`, `danger-soft`, `success`, `on-dark`, `link`;
`loading` prop), `Input`, `Select`, `Textarea`, `Field` (label + hint + error), `Badge`, `Card`, `Dialog`
(focus trap, Escape, bottom sheet on phones), `TabBar` (sliding indicator; `underline` or `segmented`),
`Toast`, `Skeleton`, `EmptyState`, `Avatar`.

`common/`: `Header`, `PageHeader`, `ClaimStatusPill` / `DecisionPill`, `SLAUrgencyBadge` (live, ticks every
30 s), `ConfidenceMeter` (marks the auto-approval threshold).
