# The trip grid is day tabs with a trail

Status: accepted (#19, for #7)

## Context

The trip grid (#7) is the screen people live in. Its job is to show the gaps:
which meals are not planned yet, which are still being discussed, and which
are decided. Breakfast, lunch and dinner happen at most once a day. "Other"
meals repeat freely: afternoon tea, a late-night snack and an airport last meal
can all fall on one day. It is read on a phone, one-handed, often in bright
sun (see [0002](0002-visual-direction.md)).

#19 prototyped three layouts in the Cartographer style, on the same mock trip:
5 days in Tokyo, three "Other" meals on one day, and all three states. The
prototype was measured in a 360px viewport in both themes, and lived in
`apps/web/prototypes/styles/` at commit `ead0af0` before it was deleted.

| Layout                                                                    | Seeing the gaps across the whole trip at 360px                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A. Day cards with a trail: one card per day, stacked                      | About one day per screen, so roughly 4 screens of scrolling for 5 days. The clearest of the three within a day               |
| B. Day-by-meal matrix: a table that scrolls sideways in its own container | Every gap on about 1.5 screens of height, but only about 2 of 5 days visible at once, so the rest needs a sideways swipe     |
| C. Day tabs with a trail: a strip of day tabs, one day's trail below      | The strip is a trip-wide gap summary that always fits on screen. The detail of which meal is missing shows one day at a time |

## Decision

The maintainer chose **C, day tabs with a trail**.

Why C, over the other two:

- **Over A (day cards):**
  - A answers "what is still open on this trip?" only by scrolling the whole
    trip, and its day headers scroll away.
  - C answers it without scrolling, and the day you are looking at never
    leaves the screen.
- **Over B (matrix):**
  - On a phone, the matrix's sideways scrolling is easy to miss and awkward
    one-handed.
  - Its narrow cells wrap restaurant names to 2 or 3 lines.
  - The Cartographer trail has no place in a table.
  - C keeps one day at full width and one tap away.
- **What C gives up:**
  - Comparing the same meal across days, such as every dinner, means flipping
    tabs. B was best at that.
  - The strip says how many gaps a day has, not which meal they are.
  - Both costs are accepted. People plan a day at a time, and the strip gets
    them to the right day in one tap.

### What #7 must carry over

1. **A strip of day tabs that always stays in view.**
   - Each tab shows the weekday, the date and a per-day summary: "N gap(s)"
     while any meal is not planned, else "N open" while any is still being
     discussed, else "Done".
   - The summary is text, not a colour or a dot.
   - The strip stays in view (sticky under the header) while the day below
     scrolls.
2. **One day's trail below the strip.**
   - The selected day's meals are listed down a dashed route line, with a pin
     per meal.
   - A pin is filled when its meal is decided and hollow otherwise
     ([0002](0002-visual-direction.md), sunlight rule 2).
   - Each meal shows a `MealSlotMarker` (`apps/web/src/ui/`) inside its own
     control, which carries the state.
3. **"Other" meals repeat on the trail.** Breakfast, lunch and dinner come
   first, in that order. Then come the day's "Other" meals, each with its own
   label, in their own stable order, followed by an "Add another meal" action.
4. **Accessibility.**
   - The strip is a tablist: `role="tab"`, `aria-selected`, one tab stop, and
     the left and right arrow keys move between days.
   - The trail is its tabpanel.
   - Every tab and every slot is at least 44px.
   - Nothing scrolls the page sideways at 360px.

### Open edges, and the decision for each

- **Trips longer than about 7 days.**
  - Tabs share the width equally down to a 44px minimum. At 360px, 7 tabs
    still fit.
  - Past that, the strip scrolls sideways inside its own container, never the
    page. It clips a tab at the edge so it is visible that more days follow.
  - The selected tab is always kept in view, scrolled to the nearest edge,
    including when the page opens on a day far into the trip.
- **Undated trips (everyday use).**
  - The strip shows the dates that have at least one meal, plus today, in date
    order. Today is labelled "Today".
  - There is no "Any day" tab. An everyday trip's question is "where are we
    eating tonight", and that needs a real day. So an everyday meal still gets
    a date: today, unless the member picks another.
  - This choice keeps every meal visible. That answers the question carried
    over from #5 on #7: clearing a trip's dates never hides anyone's meals, so
    clearing dates still needs no out-of-range warning.
  - If #7's data model cannot date everyday meals, this decision must be
    revisited there.
- **Meals outside a dated trip's new dates (decided in #7).**
  - When the organiser moves a dated trip's dates past existing meals, those
    meals are kept but hidden: the strip shows only the trip's days, and no
    tab is added for the stranded meals.
  - The date-change warning is what makes that visible. It lists the
    meals, says they will not appear in the grid until the dates include
    them again, and asks the organiser to check them with the group or
    re-add them on the new days. Its confirm button says so: "Change dates
    and hide these meals", with "Keep editing" as the focused, safe choice.
  - Clearing the dates still raises no warning, because an undated trip
    shows every meal on its own date.
- **Which tab opens by default.**
  1. During the trip, open today.
  2. Before the trip starts, open the first day with a gap (a meal not
     planned yet). If there is none, open the first day with anything still
     being discussed. Otherwise, day 1.
  3. After the trip has ended, open day 1.
  - Why: during the trip, today is what people act on. Before it, planning is
    the job, so the app opens where planning is needed. After it, the record
    reads from the start.
  - Always, before any of these: a day in the URL wins, so a shared link or a
    later digest email can open a specific day. Going back to the grid returns
    to the day you left.
  - The day is scoped to its trip: `?trip=<trip id>&day=2026-10-16`. A trip's
    grid honours `day` only when `trip` names that trip, so a day chosen in
    one trip never follows you into another, whether you switch trips or a
    reload opens on a different one. (Added in #7 review: a bare `?day=` leaked
    across trips.)
  - Opening the trip that `?trip=` names, so a digest link lands on the right
    trip as well as the right day, is left to a later change to the trip
    selection. Until then the day applies when the app opens on that trip.

## Consequences

- #7 builds this layout on the base components and tokens from
  [0002](0002-visual-direction.md). The strip's gap summary gives #10's
  "who has not voted" and the digest a natural home later, but adds nothing to
  #7's scope.
- A wide screen gets the same layout at a larger width. A matrix view for
  tablets can be added later as a separate decision, if people ask for
  cross-day comparison.
- The trade-off accepted here is comparing across days. If users often need
  "every dinner at once", revisit it by adding B as an alternate view, not by
  replacing C.
