---
title: Installation
description: Import the solution, then assign it to a table's grid.
order: 2
---

# Installation

## 1. Import the solution

Download the managed solution from the
[latest release](https://github.com/pcfhub/pcf-grid-data-bars/releases) and
import it into your environment. Publish all customizations afterwards.

## 2. Assign it to a grid

:::callout{type=warning}
**Importing the solution does nothing on its own.** A grid customizer that is
installed but never named on a grid is silently inert — it renders nothing,
changes nothing, and logs nothing to say so. This step is the one that people
miss, and the symptom is a control that appears not to work.
:::

:::steps
1. Open **Settings → Customizations → Customize the System**, or the modern
   table designer, and find the table whose grid you want bars on.
2. Open the table's **Controls** tab and add or select the **Power Apps grid
   control**.
3. Set the **Customizer control** property to:

   ```
   pcfhu_PCFHub.GridDataBars
   ```

4. Save and publish.
:::

The customizer applies to that table's grid on every view — this is not a
per-view setting.

## 3. Give a column a range

Bars appear only on columns whose attribute declares real minimum and maximum
values. On a freshly created column those are still the platform defaults, and
this control declines. Open the column in the table designer and set its
**Minimum value** and **Maximum value** to the range the column actually means,
then publish.

See [Examples](examples.md) for how to choose those numbers, and
[Limitations](limitations.md) for why both ends have to be set.

## Verifying it works

Open a view containing a numeric column you gave a range to. Each cell should
show its usual number with a tinted bar behind it, longer for larger values.
If every cell looks ordinary:

- Confirm the **Customizer control** property is set and published.
- Confirm the column has both a minimum and a maximum that differ from the
  defaults.
- Confirm you are in a model-driven app. Canvas has no Power Apps grid.
