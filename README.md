# Grid Data Bars

In-cell proportional bars for bounded numeric columns on the Power Apps grid.

[![Build](https://github.com/pcfhub/pcf-grid-data-bars/actions/workflows/build.yml/badge.svg)](https://github.com/pcfhub/pcf-grid-data-bars/actions/workflows/build.yml)
[![Release](https://github.com/pcfhub/pcf-grid-data-bars/actions/workflows/release.yml/badge.svg)](https://github.com/pcfhub/pcf-grid-data-bars/actions/workflows/release.yml)

Documentation lives on [PCFHub](https://pcfhub.dev/components/pcf-grid-data-bars), built
from the `docs/` directory in this repository. Edit the Markdown here; the hub
recompiles it.

## What it does

This is a **grid customizer**: a control that renders nothing itself and instead
hands the Power Apps grid a table of cell renderers, keyed by column data type.
Assigned to a table's grid, it draws a proportional bar behind the value in
every whole-number, decimal, floating-point and currency cell — and, far more
often, declines and lets the grid draw its own.

**The declining is the design.** A bar is a proportion and a proportion needs a
maximum, and the customizer contract gives a renderer no way to find one:
`CellRendererProps` describes a single cell, `RowData` is `{ __rec_id }` with no
sibling values, and there are no other rows to look at. Accumulating a running
maximum across the cells the grid asks for would be wrong for every row drawn
before the largest value appeared — and uncorrectable, because
`PAOneGridCustomizer` carries no `PAGridAPI` handle and nothing here can ask the
grid to re-render.

So the domain comes from the column's own `MinValue`/`MaxValue` attribute
metadata — read once for the whole table when the grid starts — and a column
whose range is still the Dataverse default gets no bar at all. That is most numeric columns on most
tables, and it is the first thing to know before installing this: bars are
opt-in by way of an admin setting a real range on the column, and there is no
setting on the control that overrides it. `docs/limitations.md` says so first
and loudest.

Two consequences look like bugs and are not. **The control has no visible output
of its own** — `updateView` returns an empty fragment, and a customizer dropped
on a form does nothing at all, correctly. And **returning `undefined` from a
renderer is the documented way to say "this cell is fine as it is"**, which is
also the only correct answer to a validation error, an unset value, and an
unbounded column.

It is *not* the right answer to a cell drawn before the ranges arrive, and that
distinction cost two versions to learn: a declined cell belongs to the grid,
this control never hears of it again, and nothing a customizer holds can ask
for a repaint. Such a cell keeps itself and redraws when the answer lands.

## Properties

| Property | Type | Usage | Default | What it controls |
| --- | --- | --- | --- | --- |
| `EventName` | SingleLine.Text | bound, **required** | — | The event the grid listens on. Set by the platform, not by a maker. |

That is the entire surface, and it is not a setting: the Power Apps grid
generates an event name, passes it in through this property, and listens on it
for the payload this control fires during `init`. An empty value means nothing
is listening, and the control returns without firing — which is exactly what
should happen anywhere that is not a customized grid.

The control is configured by being *named* on a grid rather than by having
values set on it, and what it draws is decided by each column's declared range.
See `docs/installation.md` for where that name goes.

No `uses-feature` permissions are requested, which took a finding to arrive at.
The obvious source for a column's range is `context.utils.getEntityMetadata`,
gated behind `Utility` — but that call's attribute metadata carries no
`MinValue`/`MaxValue`; the range exists only on the typed Web API metadata
entities, and reading it means casting the attribute collection to one. So the
lookup is a same-origin `fetch` against `/api/data/v9.2/`, which no feature
gates. `context.webAPI` is not a route to it either — it addresses records by
entity logical name and cannot reach `EntityDefinitions`. Where the request
cannot succeed the control is inert rather than broken: every column misses its
bounds, every renderer declines, and the grid draws its own cells. No device,
no navigation.

Localisation: `en-US` (LCID 1033) only. React 16.14.0 and Fluent 8.121.1 are
declared as `<platform-library>` entries, so neither is bundled — the elements
the overrides return are rendered by the host's own React instance, which is the
only way their hooks can work.

## Install

Download the managed solution from the
[latest release](https://github.com/pcfhub/pcf-grid-data-bars/releases/latest), or from
the component's page on the hub, and import it into your environment.

## Develop

```bash
npm install
npm run build
npm run smoke      # drives the built bundle: bar geometry and the decline paths
npm run lint
npm run check      # what CI runs first: placeholders, pcfhub.json, control shape
```

**`npm start` is not useful here.** It hosts the control the way a form would,
and a customizer correctly renders nothing on a form. To see this one work,
build and then open `dev/harness.html` — a static local stand-in for the grid
that calls the overrides the way the grid does, with switches for the host's
dark theme and for whether columns declare a range.

`npm run smoke` is the same bundle driven from Node, with the per-cell decisions
turned into assertions: the geometry, the zero baseline, the clamp, and the four
cases that decline. Both stub the metadata, so neither says anything about
whether this control reads a real Dataverse column correctly — see `SPEC.md`.

Run `npm run refreshTypes` after every manifest edit — until you do,
`context.parameters` is typed from the old manifest and `tsc` will accept code that
cannot work.

To pack the solution locally you need msbuild — either Visual Studio or the
Visual Studio Build Tools:

```bash
cd Solution
msbuild /t:build /restore /p:configuration=Release
```

Both zips land in `Solution/bin/Release`. This is the only local step that compiles
in **production** mode, so a green `npm run build` is not evidence the shipping
bundle compiles — and the pack is incremental, so delete `obj/`, `out/`,
`Solution/obj/` and `Solution/bin/` first if you intend to quote a bundle size from
it.

## Release

1. Bump the version in **three** places, in one commit — they are checked
   against each other in CI:
   - `GridDataBars/ControlManifest.Input.xml` → `<control version="…">`
   - `Solution/src/Other/Solution.xml` → `<Version>`
   - `package.json` → `"version"`
2. Tag it: `git tag v1.2.3 && git push --tags`

The release workflow builds, packs both solution types, and attaches them to a
GitHub Release. PCFHub picks the release up from its webhook within seconds, or
from the hourly sweep otherwise. A sync imports a draft; a person publishes it.

## Repository layout

| Path | What it is |
| --- | --- |
| `GridDataBars/` | The control: manifest, entry point, CSS, localised strings |
| `GridDataBars/customizers/` | The cell renderers the grid calls per cell |
| `GridDataBars/metadata/` | The attribute-metadata lookup the bars are scaled to |
| `Solution/` | The Dataverse solution that packages it |
| `SPEC.md` | What building this corrected, and what is verified versus read |
| `docs/` | The pages PCFHub publishes — see the comments in each file |
| `media/` | Images and video referenced from the docs |
| `pcfhub.json` | The hub's manifest: identity, links, docs path, demo |
| `scripts/` | Template setup and the CI guard that keeps it adopted |

## Licence

[MIT](LICENSE)
