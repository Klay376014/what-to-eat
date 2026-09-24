# The visual direction is Cartographer

Status: accepted (#19)

## Context

Every ticket from #5 onwards ships UI. Without one agreed direction, each would
invent its own colours, spacing and buttons. #19 settles the direction once,
as design tokens and a few base components.

The app is used in a particular way, and that drives the design:

- On a phone, one-handed, by a group of 2 to 8 friends standing on a street
  corner abroad, often in bright sun.
- The trip grid (#7) is the screen people live in, and its job is to show the
  gaps: every meal slot has to read as empty, being discussed or decided at a
  glance.
- Votes show who cast them (#10), so the design needs a compact way to put
  faces or initials next to a +1 / −1 count.

The choice was made from a throwaway gallery of 12 styles (it lived in
`apps/web/prototypes/styles/`, added in commits `b2e8794` and `ffc4741`, and
has since been deleted). All of them
applied the same markup and mock data, and all were checked for WCAG AA in
both themes.

- **Round 1** (Swiss Signal, Street Brutal, Soft Clay, Menu Card, Material
  Tonal, Sunlight Max) spanned minimal to loud. The maintainer found it too
  rigid, with no sense of travel. Only Menu Card, with its warm,
  printed-matter character, came close.
- **Round 2** pushed six styles in a travel direction, with Menu Card as the
  reference: Travel Journal, Postcard Poster, Boarding Pass, Cartographer,
  Washi Stationery and Field Guide.

## Decision

The maintainer chose **Cartographer**: an explorer's map, with parchment,
contour lines and a trail of pins across each day.

Why it fits:

- It feels like travel, not like a tool, which was round 1's failing. It still
  keeps Menu Card's calm, printed character.
- The map metaphor matches the job. The grid's state key reads as a map
  legend, and each day's meals can hang off a trail of pins, filled where the
  meal is decided.
- Its colours are functional map colours: sea blue for actions, park green for
  decided, trail orange for the route. All were darkened well past printed-map
  tints to reach AA.
- Fraunces (headings) gives an old-atlas feel without small caps. Cabin
  (body) stays plain and legible.

The direction is implemented as:

- `apps/web/src/styles/tokens.css`: CSS custom properties for colour, type
  scale, fonts, spacing, radius, shadow and the map motif, with light and dark
  variants. Dark follows the system unless `data-theme` forces a theme.
- `apps/web/src/styles/base.css`: element defaults and shared layout
  utilities.
- `apps/web/src/ui/`: the base components every later ticket reuses.
  - `BaseButton` (primary / secondary / destructive), `TextField`,
    `SelectField`, `BaseCard`, `EmptyState` and `ConfirmDialog` (native
    `<dialog>`).
  - `MealSlotMarker`, the empty / discussing / decided marker for #7.
  - `BaseIcon`: inline SVG icons only.
- Fonts come from Google Fonts with `display=swap` and preconnect. Every
  family has a system fallback.

No component library. Plain Vue components and custom properties are enough
for this scope.

### Theme choice and the header

The header follows the usual website pattern: the app name on the left, and on
the right the signed-in person's avatar (their Google picture, or their
initials) as a button that opens an account menu. The menu holds their name
and email, the theme choice and Sign out. A signed-out visitor sees a "Sign in"
button instead.

The theme choice is **System / Light / Dark**, and defaults to System. It lives
in the account menu, as it does in most apps that have an account menu, rather
than as a separate header icon. This keeps the header to two things on a
360px screen, and puts all per-person settings in one place. The choice is
kept in `localStorage`; if storage is unavailable it falls back to System. It
is applied through the `data-theme` hook, and a small inline script in
`index.html` sets it before the app mounts, so the wrong theme never flashes.

A signed-out visitor has no menu, so the sign-in page always follows the
device theme.

## Sunlight rules

The travel feel must never cost legibility in the sun. These rules come with
the choice, and any later change to the tokens has to keep them.

1. **Texture is backdrop only.** The contour texture uses at most 14% ink
   (`--texture-pct`) and lives on the page backdrop only. It never sits under
   text: text always sits on a solid surface, such as a card, the header bar or
   a slot fill. For that reason the prototype's grid texture on cards was
   dropped.
2. **Pins are filled when decided.** On the trip grid's trail, a decided meal's
   pin is filled and an open one is hollow. The pin is only a second signal;
   the slot marker carries the state.
3. **State is never colour alone.** Each meal-slot state has its own fill and
   border (dashed, tinted, solid), its own icon, and text. Where the visible
   text would not say the state, a visually hidden prefix does ("Being
   discussed:", "Decided:").
4. **AA in both themes.** Text pairs reach at least 4.5:1, and control
   boundaries, focus rings and the route line at least 3:1, in light and dark.
5. **Touch and width.** Tap targets are at least 44px, and every screen works
   at 360px wide with no horizontal scroll.

## Verification

`apps/web/src/styles/tokens.test.ts` reads `tokens.css` itself. It fails if any
colour pair the components render drops below its AA threshold in either
theme, if the system and forced dark themes drift apart, or if the texture goes
above 14%.

The component tests under `apps/web/src/ui/` cover the behaviour that is easy
to lose in a restyle:

- the dialog's confirm, cancel, Escape and focus return
- label and error association on inputs
- disabled buttons not firing
- the slot marker stating its state in text

## Consequences

- New UI uses the tokens and base components. A component that needs a new
  colour adds a token and an entry in `tokens.test.ts`, rather than a raw hex
  value.
- The #7 grid layout is a separate decision:
  [0003](0003-trip-grid-layout.md).
- The gallery is deleted. Every style's tokens remain in the git history at the
  commits above (and the layout study at `ead0af0`), should the direction ever
  be revisited.
