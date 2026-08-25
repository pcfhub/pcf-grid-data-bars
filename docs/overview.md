---
title: Overview
description: What Grid Data Bars does, and when to reach for it.
order: 1
---

# Grid Data Bars

In-cell proportional bars for bounded numeric columns on the Power Apps grid.

A numeric column in a grid is a list of numbers, and a list of numbers is
something you read one row at a time. Grid Data Bars draws a bar behind each
value, scaled to the range the column itself declares, so the shape of the
column is visible before any of it is read — which record is an outlier, which
cluster sits near the floor, where the spread actually is.

## Why this one

- **It never invents a scale.** The bar is proportional to the `MinValue` and
  `MaxValue` on the column's own Dataverse metadata. It is not proportional to
  the largest value on the page, which would mean the same record drew a
  different bar depending on who else was on screen with it, and would change as
  you paged.
- **It never changes the number.** The bar is drawn *behind* the platform's own
  formatted value, so what you read is what the server sorts and filters on.
- **It declines loudly rather than guessing quietly.** A column that declares no
  range gets the grid's ordinary cell, unchanged. See
  [Limitations](limitations.md) — this is the single most important thing to
  know before installing it.

## What it works with

:::callout{type=info}
**Model-driven apps only.** This is a *customizer* for the Power Apps grid
control, assigned to a table's grid rather than placed on a form. Canvas apps
have no Power Apps grid to assign it to, and the attribute metadata it reads is
model-driven only.
:::

It applies to whole-number, decimal, floating-point and currency columns. It
does not touch any other column type, and it does not replace any cell editor —
opening a cell for editing gives you the platform's own numeric editor, with the
range validation that makes the bar meaningful in the first place.
