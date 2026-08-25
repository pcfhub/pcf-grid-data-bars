---
title: Model-driven apps
description: What a grid customizer touches, and what it leaves alone.
order: 4
---

# In a model-driven app

Grid Data Bars is not added to a form. It is a **customizer** for the Power Apps
grid control, named on a table's grid — see [Installation](installation.md) for
the property and where it lives. This page is about what that assignment
actually covers, because its reach surprises people in both directions.

## It applies to the whole table

One assignment covers **every view of that table**, everywhere that table's grid
is drawn: the main grid, subgrids on other tables' forms, associated views, and
any new view created afterwards. There is no per-view setting and no way to
exclude a view.

That is why this control narrows by column *range* rather than by column name. A
name list would have to be right for every view of the table at once, forever;
a declared range is a property of the column itself, so the answer is the same
wherever the column appears.

## It touches nothing but the drawing of a cell

Everything the grid does around the value is untouched:

- **Sorting and filtering** run server-side against the real value. The bar is
  drawn behind the platform's own formatted string, so what you sort is what you
  read.
- **Editing** is entirely the platform's. This control ships no cell editors, so
  opening a numeric cell gives you the grid's own editor, with the range
  validation that comes from the same metadata the bar is scaled to.
- **Validation errors** render as the grid renders them. A cell with an error
  gets no bar at all — the error border and its message belong to elements this
  control does not own, and drawing over them would produce a cell that is
  quietly invalid and looks fine.
- **Selection, hover and focus** are the row's. The bar is painted with a
  translucent fill so row banding, the hover state and the selection highlight
  all remain visible through it.

## One customizer per grid

A table's grid has a single *Customizer control* property, so Grid Data Bars
cannot be combined with another customizer on the same table by assigning both.
Running two means merging their overrides into a single control.

## Where it does nothing

- **Canvas apps.** There is no Power Apps grid control to assign it to.
- **Read-only grids rendered by other controls.** The property belongs to the
  Power Apps grid specifically.
- **Anywhere the `Utility` feature is unavailable.** The control declares it as
  optional, so it loads and then declines every cell rather than failing.
