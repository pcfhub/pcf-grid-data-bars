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
carries no attribute metadata — nothing for `MinValue`/`MaxValue` to come from.
Every column would therefore miss its bounds and every renderer would decline,
so a demo of this control would be a grid of perfectly ordinary cells: a demo
that loads correctly, works correctly, and shows nothing this component does.

That the ranges now come from the Web API rather than `getEntityMetadata` does
not change this. The harness has no Dataverse behind it either, so the metadata
request fails the same way the old call answered nothing — and the control does
the correct thing in both cases, which is to draw the grid's own cells.

So the page carries media instead: `media/screenshot.png` on the overview, and
`media/walkthrough.mp4` on the examples page. That is the honest answer until
the harness can carry column metadata, and the reason `fidelity` stays at
`none` rather than being a placeholder nobody revisited.

## Settled on a real grid

Everything below was read off a model-driven grid rather than reasoned about,
across one session: a breakpoint in `boundsFor`, the debug table this control
prints on request, four probe columns created with their ranges left alone, and
a cold load throttled to Slow 3G. Three of the findings contradicted what the
documentation or the type definitions implied, and each had shipped as a
control that looked like it was working.

- **`context.mode.contextInfo.entityTypeName` carries the table's logical
  name.** The control stands on this — without an entity name there is no
  metadata at all — and it holds. The metadata call built from it resolves.

- **`getEntityMetadata(entity)` with no `attributes` argument returns an entity
  with no columns.** This was the open question the design rested on, and the
  answer is the bad one. The promise resolves, `Attributes` is a real
  collection object, and its backing `_collection` is empty: `.get(column)`
  answers `null` for every column on the grid. The argument is the list of
  columns to *fetch*, not a filter over columns already fetched — which the
  reference documentation states plainly once you read it as a fetch list ("The
  columns to get definitions for").

  This is the worst shape a bug can take here, and it is worth naming. Nothing
  threw, nothing rejected, and the resulting behaviour — every cell declines,
  every column draws the grid's own cell — is *exactly* what a correctly
  working control looks like on a table where nobody declares a range. The
  control had no bug you could see; it just never drew a bar anywhere.

  Naming the columns fixes it, and the column names first exist in the renderer
  — but naming them only exposed the next failure, below.

- **`context.utils.getEntityMetadata` cannot answer this question at all.**
  With the columns named, `Attributes.get('cll_score')` returns a real
  attribute — and its `MinValue` and `MaxValue` are `undefined`, on a decimal
  column with both ends set in the table designer.

  This is the documentation being right and the type definitions being
  misleading. The client-API reference lists exactly four properties shared by
  every column type — `AttributeType`, `DisplayName`, `EntityLogicalName`,
  `LogicalName` — and per-type extras only for the choice-shaped types. Nothing
  numeric. Meanwhile `@types/powerapps-component-framework` *does* declare
  `MinValue`/`MaxValue`, under `PropertyHelper.FieldPropertyMetadata`, which is
  the shape a **bound field property** on an ordinary control carries — a
  different object reached a different way. A customizer binds no field, so it
  has no route to that one.

  The range exists on the typed Web API metadata entities —
  `DecimalAttributeMetadata` and its three siblings — and the attribute
  collection has to be **cast** to one before `MinValue` can even be named in a
  `$select`. The control now reads it there, through a same-origin `fetch`
  against `/api/data/v9.2/`, one request per numeric type rather than per
  column. `context.webAPI` is not a route to it either: it addresses records by
  entity logical name and cannot reach `EntityDefinitions`.

  The manifest's `Utility` feature-usage went with it, since nothing calls
  `context.utils` any more.

  `dev/smoke.js` missed both failures because it stubbed the client API and was
  more generous than the platform — it ignored the `attributes` argument and
  answered for every column. A stub more capable than the real thing turns a
  suite green for a control that does nothing. It now stubs `fetch`, answers
  only for the cast it was actually given, and asserts the shape of the request
  rather than only what the control does with an answer.

- **Re-firing the customizer event does not make the grid repaint.** The grid
  takes the second payload and draws nothing new. Verified by the symptom it
  causes: with the ranges arriving after the first paint, every bar was missing
  until the cell was *clicked* — a click invalidates that one cell, the grid
  calls the renderer again, and the bar appears for that cell alone.

  So a customizer has no way at all to ask for a repaint: not `PAGridAPI`,
  which it is never handed, and not the event, which is the only channel it
  does have. Two things follow, and together they are the fix.

  **The answer has to beat the first paint.** It now can, and only because the
  metadata source changed: the Web API query needs the *table* name, which
  `init` has, where the client API needed *column* names, which do not exist
  until the grid asks for a cell. The lookup moved into `init` and the whole
  render-time request machinery — the queue, the batching timeout, the
  side-effect-during-render argument — was deleted with it. Four unfiltered
  requests, one per numeric type, in flight before a cell exists.

  **A cell drawn before it lands must not decline.** Returning `undefined`
  hands the cell to the grid permanently, which is precisely how the bug
  worked. `PendingCell` keeps the cell instead, draws the platform's own
  formatted value, subscribes to the metadata module, and re-renders itself
  into a bar when the ranges arrive. A React subscription doing a job that
  looks like the grid's is not elegance; it is the only handle that exists.

- **Three of the four `PLATFORM_DEFAULTS` constants were right; `FloatingPoint`
  was wrong.** Four columns created through the modern designer with Minimum
  and Maximum left alone, read back through the Web API: `Integer`
  `-2147483648..2147483647`, `Decimal` ±100 billion and `Currency`
  ±922337203685477 all matched. A fresh **float** carries `0..1000000000` — not
  the ±100 billion the type accepts — so every unconfigured float column in
  every environment was drawing a bar. Corrected.

- **The check catches a *fresh* column and not a stock one, which is a narrower
  guarantee than the design assumed.** The same run listed every numeric
  attribute on the table, and Microsoft's own columns carry ranges that are
  neither the type default nor anything a maker chose: `creditlimit`, `revenue`,
  `marketcap` and the aging columns all declare `0..100000000000`;
  `numberofemployees` and `sharesoutstanding` declare `0..1000000000`;
  `timezoneruleversionnumber` and `utcconversiontimezonecode` declare
  `-1..2147483647`. None equals its type's default, so all of them pass
  `isPlatformDefault` and draw a bar — one whose width rounds to zero for any
  realistic value.

  Note what this means for the README's own worked example: a credit limit of
  40,000 against a maximum of one hundred billion is not hypothetical, it is
  `account.creditlimit` as shipped, and it is drawing an invisible bar today.
  The currency `_base` twins are declined, because those *do* carry the raw
  default — so a table shows the same column suppressed and drawn depending on
  which of the pair you put on the view.

  Nothing about the visible output was wrong: an invisible bar is invisible.
  The cost was the accessible label, which announced "0% of column range" on
  columns nobody customized — worse than silence, because it tells a
  screen-reader user the column has a meaningful scale and this value sits at
  the bottom of it.

  Fixed per cell rather than per column: `barCell` declines when the bar's width
  rounds to `0%`. That needs no new constants and no guessing at which stock
  ranges exist on tables nobody has looked at yet, and it stays right on a
  column that holds both trivial and enormous values. The alternative —
  extending `PLATFORM_DEFAULTS` with the observed stock ranges — would suppress
  a maker who picked one of them deliberately, and the list would never be
  finished.

  What it costs: a value sitting exactly at its column's minimum, in a range
  that *is* meaningful, stops announcing a truthful "0%" and draws the grid's
  own cell. Identical on screen, and the cheaper thing to lose.

- **An element replaces the cell's interactions, not just its pixels.** Bars
  drew correctly and the cells stopped being editable. Nothing in the customizer
  contract announces this and nothing local catches it, because the failure is
  *partial*: row selection is owned by the grid and keeps working, so the cell
  highlights, takes a focus ring and looks entirely alive while refusing to open
  an editor.

  `CellRendererProps` provides for it — `onCellClicked` ("callback indicating
  the grid cell has been clicked"), `startEditing` and `columnEditable` exist so
  a renderer can hand back what it displaced, and once you have drawn your own
  element nothing else can raise them. `cellHandlers` now spreads both gestures
  onto every element this control returns, including `PendingCell`'s plain
  value.

  No `tabIndex` or key handlers with them: the grid owns cell focus and keyboard
  navigation at the row level, so Enter and F2 never reached this element, and a
  tabbable node inside the cell would add a second stop to a roving-tabindex
  surface this control does not own.

- **The whole path works end to end.** Verified on an `account` view with a
  `Decimal` column declaring `0..100`: bars on first paint, untouched, widths
  proportional to the values, and an empty cell drawing no bar rather than a
  zero-length one. The same-origin `fetch` against `/api/data/v9.2/` succeeds
  from inside a grid customizer with no declared feature and no token — the
  session authenticates it, and reading metadata needs no privilege beyond
  being signed in.

- **The waiting state is invisible, including on unbounded columns.** Watched
  on a cold load throttled to Slow 3G, on a view carrying one bounded `Decimal`
  (`0..100`) and one left at its defaults. Every numeric cell mounts a
  `PendingCell` while the ranges travel — the unbounded column's included — and
  each draws the platform's formatted value and nothing else. When the answer
  lands the bounded column fills in through the subscription and the unbounded
  one does not change.

  Nothing flickered and nothing moved: the numbers hold their position to
  within a pixel across the transition, because the bar is absolutely
  positioned behind the text and its arrival reflows nothing. The theoretical
  cost recorded here — a cell that is briefly slightly less than the grid's own
  — is not observable even with the network deliberately crippled.

## Not verified

- **That the `Utility` feature is granted to a customizer at all.** Moot rather
  than open: nothing calls `context.utils` any more and the manifest declares no
  feature. Kept because it is the reason the question stopped mattering, not
  because it was ever answered.

## Promoting a finding

The first two bullets under *Platform behaviour* are general — true of every
grid customizer, not of this control — and belong in the skill's
`references/control-patterns.md` under *Grid customizers*, with this file
reduced to a pointer once they land there.
