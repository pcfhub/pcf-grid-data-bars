---
title: Limitations
description: What Grid Data Bars does not do.
order: 7
---

# Limitations

- **Only columns that declare a real range get a bar.** This is the big one, and
  it will be most columns on most tables. Every numeric attribute in Dataverse
  carries a `MinValue` and a `MaxValue` whether or not anybody chose them, and
  the defaults span the entire numeric type — a maximum of one hundred billion
  for a decimal, of about 2.1 billion for a whole number. A credit limit of
  40,000 against a default maximum would draw a bar too small to see, on every
  row, forever. So when either end of the range is still the platform default,
  this control declines and the grid draws its ordinary cell. To turn bars on
  for a column, set its Minimum and Maximum values in the table designer; see
  [Examples](examples.md).

- **Model-driven apps only.** It is assigned through the Power Apps grid
  control's *Customizer control* property, which canvas apps do not have. It
  also reads attribute metadata through the `Utility` feature, which is
  model-driven only. Where that feature is unavailable the control is inert
  rather than broken — every column declines and the grid looks untouched.

- **Whole number, decimal, floating point and currency, and nothing else.**
  Duration columns are deliberately excluded: their raw value is a count of
  minutes while the cell displays something like "1 hour", so a bar scaled to
  the raw value would be proportional to a number the reader cannot see.

- **A value equal to the range's floor draws nothing.** A zero-length bar is
  the honest rendering of "this is the bottom of the declared range", but it
  looks identical to a column that has no bars at all. If a column's real floor
  is above its declared minimum, that reads better than it sounds; if it is not,
  expect a sparse-looking column.

- **Values outside the declared range are clamped, not flagged.** A record can
  hold a value its column's metadata forbids — ranges are enforced on write, and
  metadata gets edited after rows exist. Such a value draws a full-width bar
  rather than one running past the cell into its neighbour. The number itself is
  still displayed exactly as the platform formats it.

- **One customizer per grid.** This is a platform constraint rather than a
  choice: a table's grid has a single *Customizer control* property. Running
  Grid Data Bars alongside another customizer means merging both sets of
  overrides into one control.

- **No demo on this page.** The hub's demo harness stands up a grid over a
  fixture, and a fixture carries no attribute metadata — so a demo of this
  control would show a grid with no bars in it, which is a worse answer than no
  demo. See [`SPEC.md`](https://github.com/pcfhub/pcf-grid-data-bars/blob/main/SPEC.md)
  in the repository for what has and has not been verified on a real grid.
