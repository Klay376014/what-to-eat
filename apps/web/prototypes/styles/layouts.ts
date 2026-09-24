/* The #7 layout study: what each layout is, and what it costs. No choice made here. */
export interface LayoutNote {
  id: "cards" | "matrix" | "tabs";
  name: string;
  summary: string;
  gaps: string;
  pros: string[];
  cons: string[];
}

export const layouts: LayoutNote[] = [
  {
    id: "cards",
    name: "A. Day cards with a trail",
    summary:
      "One card per day, stacked vertically. Each day's meals hang off a dashed trail with a pin per meal.",
    gaps: "Weakest for the whole trip at once: at 360px one screen shows about one day, so seeing every gap in 5 days means scrolling roughly 4 screens. Within a day, gaps are the most obvious of the three (full-width dashed slots, hollow pins).",
    pros: [
      "Simplest and most robust: nothing scrolls sideways, full-width slots show whole restaurant names.",
      "Any number of Other meals just adds rows; the trail keeps their order.",
      "Works the same for an undated trip (one open-ended list).",
    ],
    cons: [
      "Long page on a 7-day trip; the trip-wide 'what is still open' question needs a summary at the top.",
      "Day headers scroll away, so it is easy to lose which day you are in.",
    ],
  },
  {
    id: "matrix",
    name: "B. Day-by-meal matrix",
    summary:
      "A real table: meals down the side, days across, scrolling sideways inside its own container. The meal column stays put.",
    gaps: "Best for the whole trip: every gap in the trip is on about 1.5 screens of height, and the meal column makes 'which lunches are missing' a single row scan. But at 360px only about 2 of 5 days are visible at once, so the gaps on Sat and Sun need a sideways swipe.",
    pros: [
      "Closest to the PRD's 'grid of days and meal slots' and to a calendar.",
      "Comparing the same meal across days (every dinner) is one glance along a row.",
      "Scales to wider screens for free: a tablet shows the whole trip.",
    ],
    cons: [
      "Sideways scrolling on a phone is easy to miss and fights one-handed use; needs a visible cue that more days exist.",
      "Narrow cells wrap restaurant names to 2 to 3 lines; the Other row gets tall on a busy day (Fri).",
      "No trail motif: the route line does not fit a table.",
    ],
  },
  {
    id: "tabs",
    name: "C. Day tabs with a trail",
    summary:
      "A strip of 5 day tabs, each saying how many gaps that day has, and one day's trail at a time below.",
    gaps: "A middle path: the tab strip is a trip-wide gap summary that always fits on one screen (per day: '2 gaps', '1 open', 'Done'), but you see which meals are missing only one day at a time. The strip counts gaps; it does not show which meal.",
    pros: [
      "Whole trip in view without scrolling: the strip answers 'which day needs work' at once.",
      "One-handed friendly: tap a day, everything for it fits on about one screen.",
      "Keeps the Cartographer trail, and the day never scrolls out of view.",
    ],
    cons: [
      "Beyond about 7 days the strip must scroll or wrap, which reintroduces the matrix problem.",
      "Comparing across days (every dinner) means flipping tabs.",
      "Needs a rule for undated trips (probably a single 'Any day' tab).",
    ],
  },
];
