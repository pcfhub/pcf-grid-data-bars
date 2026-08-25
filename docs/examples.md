---
title: Examples
description: Worked configurations of Grid Data Bars.
order: 6
---

# Examples

Every example here is a *column* configuration, not a control configuration.
Grid Data Bars has no settings — what it draws is decided entirely by the range
each column declares, so configuring it means choosing those two numbers well.

::video{src=media/walkthrough.mp4 poster=media/walkthrough-poster.png}

The first configuration below is the one in that recording: a `Decimal` column
with a declared range of `0` to `100`.

## A percentage column

The easy case, and the one to start with.

| Setting | Value |
| --- | --- |
| Data type | Decimal |
| Minimum value | `0` |
| Maximum value | `100` |

Every value maps onto the full width of the cell, the bar starts at the left
edge, and the reading is exactly what a reader expects from a percentage. If you
have one column to try this on first, make it this one.

## A currency column with a working range

The case that needs thought. A credit limit might technically run to a billion,
but a range is not a legal maximum — it is the span you want the column *read*
against.

| Setting | Value |
| --- | --- |
| Data type | Currency |
| Minimum value | `0` |
| Maximum value | `250000` |

Choose the maximum from the data, not from the field's capacity. If almost every
record sits under 50,000 and one sits at 900,000, a range of `0`–`1000000`
renders the entire column as a row of invisible stubs next to one full bar. A
range of `0`–`250000` makes the ordinary records readable and clamps the outlier
to full width, which is the correct reading: *off the scale*.

:::callout{type=info}
Values above the maximum are clamped to a full bar rather than overflowing the
cell. The number itself is always displayed in full, so nothing is hidden by
the clamp.
:::

## A column that crosses zero

Variance, margin, or any balance that can go either way.

| Setting | Value |
| --- | --- |
| Data type | Decimal |
| Minimum value | `-50` |
| Maximum value | `50` |

Here the bar is anchored at zero rather than at the left edge, so negatives
extend leftward from the centre and positives rightward. This is the case that
makes the zero baseline worth having: with a left-anchored bar, `-40` in this
range would draw a bar 10% of the way across and read as a small positive.

## A column that should *not* get bars

Leave the range at its defaults and this control declines — the cell renders
exactly as the platform renders it. That is the intended way to keep bars off a
column: there is no opt-out list to maintain, because opting in is what setting
a range means.

This is also why a freshly created numeric column shows no bars. Nothing is
wrong; nobody has said what its range is yet.
