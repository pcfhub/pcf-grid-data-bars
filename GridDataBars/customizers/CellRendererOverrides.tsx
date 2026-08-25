import * as React from 'react';
import { Bounds, boundsFor } from '../metadata/ColumnBounds';
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
 *      unbounded column, every unset value, every cell drawn before the
 *      metadata resolves. That is the design working, not failing.
 *   2. **These functions must be pure.** No state, no caching, no writing to
 *      the record. `boundsFor` is a read.
 *   3. **Never render a different value than the cell holds.** The bar is drawn
 *      *behind* `formattedValue`, which is the platform's own string — this
 *      control never formats a number itself, so what a user reads is what the
 *      server sorts and filters on.
 *   4. **Stay cheap.** These run per cell on a scrolling surface. The geometry
 *      below is four arithmetic operations and no text measurement.
 */

/** Column types whose values are numbers with a declarable range. */
const NUMERIC_TYPES: ColumnDataType[] = [
    'Integer',
    'Decimal',
    'FloatingPoint',
    'Currency',
];

/*
 * `Duration` is deliberately absent. Its raw value is a count of minutes and
 * its metadata range describes that count, so a bar drawn from it would be
 * proportional to something the cell does not display — the cell reads
 * "1 hour" and the bar measures 60. That is rule 3, and the fix is not a
 * formatting change: durations are read as durations, not as positions in a
 * range, so the visual does not fit the column even where the numbers do.
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

    // No declared range: nothing to be proportional to. This is the common
    // case, not the exception — see `isPlatformDefault` in ColumnBounds.ts.
    if (!bounds) {
        return undefined;
    }

    const geometry = barGeometry(props.value, bounds);
    const text = props.formattedValue ?? String(props.value);

    // The grid right-aligns numeric columns and says so. Ignoring it leaves the
    // column most likely to be aligned as the only one that is not — a ragged
    // edge against every untouched numeric column beside it. The *bar* still
    // grows from its own baseline; it is the text that moves.
    const alignment = props.isRightAligned ? ' GridDataBars-right' : '';

    return (
        <div
            className={`GridDataBars-cell${alignment}`}
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

    return {
        left: `${percentage(left)}%`,
        width: `${percentage(width)}%`,
        negative: valueFraction < baselineFraction,
        percent: Math.round(width * 100),
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
