# Grid Data Bars

In-cell proportional bars for bounded numeric columns on the Power Apps grid.

## What the build disagreed with

Nothing. The build is clean, and that is worth one line rather than a section:
everything difficult about this control was decided by reading the customizer
contract before writing code, not by the compiler afterwards.

## Platform behaviour worth knowing

- **A cell renderer has no access to any other cell, and no way to get one.**
  Read from the vendored `types.ts`: `CellRendererProps` carries `value`,
  `formattedValue`, `columnDataType`, `rowHeight`, `isRightAligned`,
  `validationError`, and `RowData` is `{ __rec_id: string }` — the row's id and
  nothing else. There are no sibling column values and no access to other rows.

- **A customizer cannot make the grid re-render.** `PAOneGridCustomizer` has
  exactly three keys — `gridCustomizer`, `cellRendererOverrides`,
  `cellEditorOverrides`. No `PAGridAPI` handle is passed in, and there is no
  callback that receives one.

  Those two together are what decided this control's design. The obvious data
  bar scales to the largest value on screen, which needs both: something to
  observe the other rows with, and something to correct the rows already drawn
  when a larger value turns up. Neither exists, and no amount of care makes an
  accumulated running maximum correct — it is simply wrong for every row above
  the fold, permanently, with no way to fix it. That is why the domain comes
  from attribute metadata instead, and why the control declines so often. It is
  a negative result doing load-bearing work.

- **A customizer does not know which table it is on.** Every other control shape
  can ask its dataset (`getTargetEntityType()`); a customizer binds nothing but
  the event name the host generates. Both candidates this control tries —
  `context.mode.contextInfo.entityTypeName` and `context.page.entityTypeName` —
  are cast through, because `@types/powerapps-component-framework` declares
  neither: read from the type definitions, `interface Mode` has
  `allocatedHeight`, `allocatedWidth`, `isControlDisabled`, `isVisible`, `label`
  and three methods, and there is no `page` on the context at all. That is the
  same lag that hides `factory.fireEvent`, so an absent type is not evidence of
  an absent API — but it is not evidence of a present one either. See *Not
  verified*.

- **An absolutely positioned track beats reading `rowHeight`.** The contract
  hands renderers a `rowHeight`, and the instinct is to compute a pixel height
  from it. Insetting a positioned element with `top`/`bottom` instead is fewer
  lines and correct at row heights the control never sees, including any the
  platform adds later. `rowHeight` still matters for *editors*, which have to
  size an input; it does not for a decoration that can fill its own cell.

## Demo

`fidelity: "none"`, and it is not a placeholder.

The hub's grid harness renders a grid over a dataset fixture, and a fixture
carries no attribute metadata — there is no `getEntityMetadata` behind it and
nothing for `MinValue`/`MaxValue` to come from. Every column would therefore
miss its bounds and every renderer would decline, so a demo of this control
would be a grid of perfectly ordinary cells: a demo that loads correctly, works
correctly, and shows nothing this component does. Screenshots are the honest
answer until the harness can carry metadata.

## Not verified

Everything here needs one session on a real model-driven grid. None of it is
reachable from a build, and each would fail quietly rather than loudly.

- **That `context.mode.contextInfo.entityTypeName` exists and carries the
  table's logical name on a grid customizer.** This is the one the control
  stands on: without an entity name there is no metadata, and with no metadata
  every cell declines and the control is a well-documented no-op. Proof is one
  breakpoint in `resolveBounds`. If neither candidate carries a name, the design
  has to change rather than be patched — there is no third source.

- **That `getEntityMetadata(entity)` with no `attributes` argument returns
  every attribute**, rather than an object whose `Attributes` collection only
  answers for names that were requested. The prefetch runs in `init`, before any
  `colDefs` exist, so there are no column names to ask for. If it returns only
  what was asked for, the fallback is to move the call to the first renderer
  that sees an unknown numeric column and accept that bars appear one natural
  re-render later — which is a real behaviour change, not a refactor.

- **The platform default ranges in `PLATFORM_DEFAULTS`.** Taken from the
  Dataverse attribute-metadata documentation, not read back off an environment.
  A wrong constant is invisible in both directions: bars appear on columns that
  declare nothing, or vanish from columns that do, and both look like a design
  decision rather than a bug. Read the four defaults off a real table and diff.

- **That bars appear on the grid's first paint.** `resolveBounds` is started in
  `init` and the renderers decline until it lands. `init` runs well before any
  cell mounts, so in principle the metadata is there in time — but nothing can
  force a re-render if it is not, and the failure mode is a grid that draws
  ordinary cells until the user scrolls. Watch a cold load on a slow connection.

- **That the `Utility` feature is granted to a customizer at all.** It is
  declared `required="false"`, so a refusal degrades to "no bars" rather than
  failing to load — but "no bars" is also what a correctly working control looks
  like on an unbounded column, so the two are indistinguishable from the
  outside.

## Promoting a finding

The first two bullets under *Platform behaviour* are general — true of every
grid customizer, not of this control — and belong in the skill's
`references/control-patterns.md` under *Grid customizers*, with this file
reduced to a pointer once they land there.
