---
title: FAQ
description: Questions that come up more than once.
order: 8
---

# FAQ

## I imported the solution and nothing changed

Importing installs the control; it does not switch it on. A customizer has to be
named on a table's grid — **Customizer control** = `pcfhub_PCFHub.GridDataBars`
— and until it is, the control is installed, inert, and logs nothing to say so.
[Installation](installation.md) has the full path.

## It is assigned, and my numeric column still has no bars

Almost always the column has no declared range. Open it in the table designer
and check that **Minimum value** and **Maximum value** are both set to something
other than the defaults, then publish. A column left at its defaults is
indistinguishable from a column nobody has configured, and this control treats
it as one.

If both are set, check the column's type: only whole number, decimal, floating
point and currency draw bars.

## Why do I have to set both ends? I only care about the maximum

Because a range is two numbers, and picking the other one for you would be this
control inventing the thing it exists to read. The obvious guess — treat a
default minimum as zero — is wrong for every column that can go negative, and
wrong silently: the bars all look plausible.

If your column starts at zero, say so by setting the minimum to `0`. That takes
one field and removes the guess.

## Can I choose the colour?

No, and that is deliberate rather than pending. A customizer is assigned to a
table's whole grid, so any setting on it would apply to every column of that
type on every view of that table — which is almost never what the setting was
meant to say. The palette adapts to the host's light and dark themes and
degrades to an outline under Windows high contrast.

## Does it slow the grid down?

The per-cell work is a metadata lookup and four arithmetic operations, with no
text measurement and no layout read. The entity's metadata is fetched once when
the grid starts, not per cell or per page.

## Will it show a bar for a value bigger than the maximum?

It draws a full-width bar. The value is out of the declared range, and *at or
past the top of the scale* is the honest reading; letting the bar run past the
cell would paint over the next column. The number itself is displayed in full.

## Does it work in canvas apps?

No. The *Customizer control* property belongs to the Power Apps grid control,
which canvas apps do not have.

## Can I use it alongside another grid customizer?

Not by assignment — a grid has one *Customizer control*. Two customizers on one
table means combining their renderers into a single control.
