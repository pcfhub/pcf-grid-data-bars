import * as React from 'react';
import {
    Bounds,
    NUMERIC_TYPES,
    boundsFor,
    isResolved,
    subscribeToBounds,
} from '../metadata/ColumnBounds';
import {
    CellRendererOverrides,
    CellRendererProps,
    ColumnDataType,
    GetRendererParams,
} from '../types';

/**
 * A proportional bar behind the value, on columns that declare a range.
 *
 * Keyed by the grid's own column data type, so an override applies to every
 * column of that type on the grid the control is assigned to. Narrowing happens
 * inside — but not by column *name*, which is the usual way. This control
 * narrows by whether the column's attribute metadata declares a real
 * `MinValue`/`MaxValue`, which means the answer is the same on every table it
 * is ever assigned to and no name list has to be maintained. See
 * `../metadata/ColumnBounds.ts` for why that is the only domain available.
 *
 * The four platform rules shape everything here:
 *
 *   1. **Return undefined to decline**, and this control declines a lot — every
 *      unbounded column, every unset value. That is the design working, not
 *      failing. What it must *not* decline is a cell whose range has simply not
 *      arrived yet: a declined cell belongs to the grid, and nothing here can
 *      ask for it back. See `PendingCell`.
 *   2. **These functions must be pure.** No state, no caching, no writing to
 *      the record. `boundsFor` is a read.
 *   3. **Never render a different value than the cell holds.** The bar is drawn
 *      *behind* `formattedValue`, which is the platform's own string — this
 *      control never formats a number itself, so what a user reads is what the
 *      server sorts and filters on.
 *   4. **Stay cheap.** These run per cell on a scrolling surface. The geometry
 *      below is four arithmetic operations and no text measurement.
 */

/*
 * `NUMERIC_TYPES` — the four types overridden below, and why `Duration` is not
 * among them — lives in `../metadata/ColumnBounds` with the ranges it selects.
 */

export const cellRendererOverrides: CellRendererOverrides = Object.fromEntries(
    NUMERIC_TYPES.map((dataType) => [dataType, renderDataBar]),
) as CellRendererOverrides;

/**
 * One renderer, shared by all four numeric types.
 *
 * The type is read back off `props.columnDataType` rather than closed over,
 * because the bounds check needs it to know which platform default range counts
 * as "unbounded" — and the grid passes it in for exactly this reason.
 */
function renderDataBar(
    props: CellRendererProps,
    params: GetRendererParams,
): React.ReactElement | undefined {
    // A renderer that returns an element replaces the *whole* cell, and the
    // grid's error border and message go with it. The message lives in an
    // element `cellErrorLabelId` names, which this control does not own and
    // cannot rebuild, so rendering through a validation error produces a cell
    // that is quietly invalid and looks fine.
    if (props.validationError != null) {
        return undefined;
    }

    // An unset numeric column is not zero, and drawing it as a zero-length bar
    // says it is. The grid already knows how to draw an empty cell.
    if (typeof props.value !== 'number' || !Number.isFinite(props.value)) {
        return undefined;
    }

    const column = params.colDefs[params.columnIndex];
    const dataType = props.columnDataType;

    if (!column || !dataType) {
        return undefined;
    }

    const bounds = boundsFor(column.name, dataType);

    // Declines on its own account when the bar would round to nothing, which is
    // why its result is returned rather than assumed to be an element.
    if (bounds) {
        return barCell(props, bounds);
    }

    // No declared range: nothing to be proportional to. This is the common
    // case, not the exception — see `isPlatformDefault` in ColumnBounds.ts.
    if (isResolved()) {
        return undefined;
    }

    // The ranges are still in flight. Declining here is what the first two
    // versions of this control did, and it is the wrong answer: a declined cell
    // is the grid's own, this control never hears of it again, and nothing can
    // ask for a repaint when the answer lands — so the bar appeared only when
    // the user happened to click the cell. Keeping the cell keeps a handle on
    // it. See `PendingCell`.
    return <PendingCell cell={props} column={column.name} dataType={dataType} />;
}

interface PendingCellProps {
    readonly cell: CellRendererProps;
    readonly column: string;
    readonly dataType: ColumnDataType;
}

/**
 * Everything the cell this one replaced was doing besides drawing.
 *
 * A renderer that returns an element replaces the grid's own cell *and its
 * interactions*. Row selection survives, because the grid owns the row — which
 * is what makes this so easy to miss: the cell highlights, takes a focus ring,
 * and looks entirely alive. What is gone is editing. The user clicks a value
 * they can see is editable and nothing opens, on every customized column, with
 * nothing logged.
 *
 * The contract provides for exactly this and it is the reason these three
 * fields exist on `CellRendererProps`. `onCellClicked` is documented as
 * "callback indicating the grid cell has been clicked" — a renderer that draws
 * its own element is the only thing that can raise it. `startEditing` opens the
 * editor directly, and `columnEditable` says whether there is one to open.
 *
 * Both gestures are wired. Forwarding the click is the contract-driven half;
 * the double-click is belt and braces, because which gesture the grid turns
 * into an edit is its own business and may differ between a read-only grid with
 * inline editing and one with *Enable editing* set. `startEditing` on a cell
 * already editing is a no-op, so the overlap costs nothing.
 *
 * No keyboard handling here on purpose. The grid owns cell focus and keyboard
 * navigation at the row level — Enter and F2 never reached this element — and
 * adding a tabbable element inside a grid cell would put a second stop in a
 * roving-tabindex surface this control does not own.
 */
function cellHandlers(props: CellRendererProps): {
    className: string;
    onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
    onDoubleClick?: () => void;
} {
    // The grid right-aligns numeric columns and says so. Ignoring it leaves the
    // column most likely to be aligned as the only one that is not — a ragged
    // edge against every untouched numeric column beside it. The *bar* still
    // grows from its own baseline; it is the text that moves.
    const alignment = props.isRightAligned ? ' GridDataBars-right' : '';

    return {
        className: `GridDataBars-cell${alignment}`,
        onClick: props.onCellClicked,
        onDoubleClick: props.columnEditable
            ? () => props.startEditing?.()
            : undefined,
    };
}

/** The platform's own string for the value, never one this control formats. */
function textOf(props: CellRendererProps): string {
    return props.formattedValue ?? String(props.value);
}

/**
 * A cell that draws its value now and its bar when the range arrives.
 *
 * Only mounted for the race, and the race should usually be lost by the
 * network: `resolveBounds` runs in `init`, well before the grid asks for a
 * cell, so on most loads the ranges are already in hand and `renderDataBar`
 * never gets here. This is what happens when they are not.
 *
 * It renders the platform's own `formattedValue` and nothing else, so a cell
 * waiting is a cell that looks untouched. When the answer says this column has
 * no range the text is all it will ever draw — very slightly *less* than the
 * grid's own cell would, until the next natural re-render replaces it — and
 * that is the trade this makes: a brief plain cell on unbounded columns, in
 * exchange for bars that appear on bounded ones without being clicked on.
 *
 * A hook in a cell renderer is safe here for the reason the manifest declares
 * React as a `platform-library`: the element is rendered by the host's React
 * instance, so its hooks dispatch through the same one that mounted it.
 */
function PendingCell(props: PendingCellProps): React.ReactElement {
    const [, redraw] = React.useState(0);

    React.useEffect(() => {
        // The answer can land between this render and this effect, in which
        // case there is no notification coming and the cell has to look again.
        if (isResolved()) {
            redraw((count) => count + 1);

            return undefined;
        }

        return subscribeToBounds(() => redraw((count) => count + 1));
    }, []);

    const bounds = boundsFor(props.column, props.dataType);
    const bar = bounds && barCell(props.cell, bounds);

    // A cell that cannot decline, so an invisible bar falls back to the plain
    // value rather than to the grid's own cell. Same pixels either way — and
    // the same interactions, which is why this carries the handlers too.
    return (
        bar ?? (
            <div {...cellHandlers(props.cell)}>
                <span className="GridDataBars-value">{textOf(props.cell)}</span>
            </div>
        )
    );
}

/**
 * The bar, or nothing when there would be no bar to see.
 *
 * A range can be declared and still be useless: Dataverse ships columns whose
 * ranges nobody chose and which no default check can recognise — `creditlimit`,
 * `revenue` and `marketcap` declare `0..100000000000`, `numberofemployees`
 * declares `0..1000000000`, `utcconversiontimezonecode` declares
 * `-1..2147483647`. Those are not the type's defaults, so `isPlatformDefault`
 * passes them, and a real value against them computes a bar some millionth of a
 * cell wide.
 *
 * Suppressing that is not about the pixels — a bar rounded to `0%` is already
 * invisible, and declining draws the identical cell. It is about the accessible
 * label. Rendering announces "40,000. 0% of column range." on a column nobody
 * customized, which is worse than saying nothing: it tells a screen-reader user
 * this column has a meaningful scale and that this value sits at the bottom of
 * it. Neither is true.
 *
 * The cost is a value sitting exactly at its column's minimum, in a range that
 * *is* meaningful. It stops announcing a truthful "0%" and draws the grid's own
 * cell instead. That case looks the same on screen either way, and it is the
 * cheaper thing to lose.
 */
function barCell(
    props: CellRendererProps,
    bounds: Bounds,
): React.ReactElement | undefined {
    const geometry = barGeometry(props.value as number, bounds);

    if (!geometry.visible) {
        return undefined;
    }

    const text = textOf(props);

    return (
        <div
            {...cellHandlers(props)}
            // Bar length is exactly as inaccessible as colour on its own. A
            // screen-reader user is scanning this column for the same outliers
            // a sighted user picks out by width, so the proportion is spoken.
            aria-label={`${text}. ${geometry.percent}% of column range.`}
        >
            <span className="GridDataBars-track" aria-hidden="true">
                <span
                    className={`GridDataBars-bar${geometry.negative ? ' GridDataBars-negative' : ''}`}
                    style={{ left: geometry.left, width: geometry.width }}
                />
            </span>
            <span className="GridDataBars-value">{text}</span>
        </div>
    );
}

interface BarGeometry {
    /** CSS length for the bar's left edge, as a percentage of the track. */
    readonly left: string;
    /** CSS length for the bar's width, as a percentage of the track. */
    readonly width: string;
    /** Whether the bar extends left of the zero baseline. */
    readonly negative: boolean;
    /** Share of the track the bar covers, for the accessible label. */
    readonly percent: number;
    /** Whether the bar has any width left after rounding — see `barCell`. */
    readonly visible: boolean;
}

/**
 * Where the bar starts and how far it runs.
 *
 * Drawn from a zero baseline rather than from the left edge, which matters as
 * soon as a range crosses zero: in a −100…100 column, a bar for −40 that starts
 * at the left edge is 30% of the track wide and reads as a *positive* value
 * three tenths of the way up. From the baseline it runs leftward from the
 * middle, which is the only reading that matches the number beside it.
 *
 * Where the range does not cross zero the baseline clamps to whichever end is
 * nearer zero, so an all-positive column behaves exactly like an ordinary
 * left-anchored data bar and an all-negative one anchors at the right.
 *
 * Values outside the declared range clamp instead of overflowing. A record can
 * hold a value its column's metadata forbids — the range is validated on write,
 * and metadata changes after rows exist — and a bar running past the cell would
 * paint over the neighbouring column.
 */
function barGeometry(value: number, bounds: Bounds): BarGeometry {
    const span = bounds.max - bounds.min;

    const baseline = clamp(0, bounds.min, bounds.max);
    const baselineFraction = (baseline - bounds.min) / span;
    const valueFraction = (clamp(value, bounds.min, bounds.max) - bounds.min) / span;

    const left = Math.min(baselineFraction, valueFraction);
    const width = Math.abs(valueFraction - baselineFraction);
    const drawn = percentage(width);

    return {
        left: `${percentage(left)}%`,
        width: `${drawn}%`,
        negative: valueFraction < baselineFraction,
        percent: Math.round(width * 100),
        visible: drawn > 0,
    };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/**
 * Two decimal places, which is finer than any grid column is wide.
 *
 * Rounding to whole percent collapses every value in the bottom 1% of a range
 * to a bar of zero width — and in a column whose declared maximum is generous,
 * that is most of the rows.
 */
function percentage(fraction: number): number {
    return Math.round(fraction * 10000) / 100;
}
