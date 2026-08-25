import { ColumnDataType } from '../types';

/**
 * Where a data bar's domain comes from.
 *
 * A bar is a proportion, and a proportion needs a maximum. The customizer
 * contract gives a renderer its own cell and nothing else — `RowData` is
 * `{ __rec_id }`, with no sibling column values and no other rows — so the
 * domain cannot be measured from the data on screen.
 *
 * It cannot be accumulated across cells either, and that is the finding that
 * decided this design rather than a preference. An observed running maximum
 * would be wrong for every row the grid drew before it saw the largest value,
 * and there is no way to correct it: `PAOneGridCustomizer` has exactly three
 * keys — `gridCustomizer`, `cellRendererOverrides`, `cellEditorOverrides` — so
 * no `PAGridAPI` handle reaches the control and nothing here can ask the grid
 * to re-render. A design needing a second pass has no second pass available.
 *
 * What is left is the domain the *column* declares: `MinValue` and `MaxValue`
 * on the attribute's metadata. That is a real answer where it exists, and this
 * module's job is to be honest about how often it does not — see
 * `isPlatformDefault` below.
 */

export interface Bounds {
    readonly min: number;
    readonly max: number;
}

/**
 * The resolved entity metadata, or `undefined` until it arrives.
 *
 * Module scope rather than instance scope because the renderers are plain
 * functions the grid holds, not methods: by the time a cell asks for bounds,
 * the control instance is not on the call stack. One grid gets one customizer,
 * so there is one entity to describe.
 */
let entityMetadata: ComponentFramework.PropertyHelper.EntityMetadata | undefined;

/** Whether a resolve has been started, successfully or not. */
let requested = false;

/**
 * Start resolving the metadata this control's bars depend on.
 *
 * Called from both `init` and `updateView`, and latched, for the same reason
 * `fire()` is: the event name is a bound property, so `init` is not a
 * guaranteed place to have a usable context, and doing this twice would be two
 * network calls for one answer.
 *
 * Deliberately returns `void` rather than the promise. Nothing can be awaited
 * usefully — the renderers are synchronous, the grid owns the render schedule,
 * and there is nothing to do differently when it resolves. A rejection is
 * swallowed into "no bounds", which is the same state as "this column declares
 * none", and the control draws the grid's own cells in both.
 */
export function resolveBounds(
    context: ComponentFramework.Context<unknown>,
): void {
    if (requested) {
        return;
    }

    const entity = entityLogicalName(context);
    const utils = context.utils;

    if (!entity || !utils?.getEntityMetadata) {
        // Canvas, a preview harness, or a host that grants no Utility feature.
        // Latch anyway: this will not become true later on the same surface,
        // and retrying per render would be a request per frame.
        requested = true;

        return;
    }

    requested = true;

    // No `attributes` argument, on purpose. The prefetch runs before any cell
    // has been drawn, so there are no `colDefs` yet and no column names to ask
    // for — the names arrive with the first renderer call, long after this.
    //
    // Whether an unfiltered call returns every attribute is the open question
    // this control rests on; see SPEC.md, "Not verified". If it turns out to
    // return only what was requested, the fallback is to move this call to the
    // first renderer that sees an unknown numeric column and accept that bars
    // appear one natural re-render later.
    utils
        .getEntityMetadata(entity)
        .then((metadata) => {
            entityMetadata = metadata;
        })
        .catch(() => {
            // A rejection is indistinguishable from an unbounded column as far
            // as this control's output goes: both draw the grid's own cell.
            // Nothing is logged because nothing here is actionable by the user
            // looking at the grid.
            entityMetadata = undefined;
        });
}

/**
 * The declared domain for one column, or `undefined` if it has none.
 *
 * Synchronous, because the thing calling it is a cell renderer and the contract
 * gives those no way to wait. Before the metadata resolves every column misses,
 * which draws the grid's own cell — the correct answer to "I do not know yet",
 * and identical to the answer for "this column declares no domain".
 *
 * Reads through `Attributes.get()` rather than enumerating. **`Object.keys` on
 * this object returns private fields and not `Attributes` at all**, because the
 * public surface is prototype getters and enumeration does not traverse a
 * prototype chain — code that walks it concludes the entity has no attributes
 * while `.get()` works perfectly well.
 *
 * No memoisation, and that is deliberate: this is called from a renderer, the
 * contract requires renderers to be pure, and a module-level cache written
 * during render is a side effect during render. The work saved would be one map
 * lookup and four property reads.
 */
export function boundsFor(
    column: string,
    dataType: ColumnDataType,
): Bounds | undefined {
    const attribute = entityMetadata?.Attributes?.get?.(column);

    if (!attribute) {
        return undefined;
    }

    const min: unknown = attribute.MinValue;
    const max: unknown = attribute.MaxValue;

    if (typeof min !== 'number' || typeof max !== 'number') {
        return undefined;
    }

    // A degenerate range divides by zero below, and an inverted one is a
    // metadata error this control should not try to interpret.
    if (max <= min) {
        return undefined;
    }

    if (isPlatformDefault(min, max, dataType)) {
        return undefined;
    }

    return { min, max };
}

/**
 * Whether this range is the one Dataverse assigns when nobody chooses.
 *
 * This is the check that keeps the control honest, and it is why most numeric
 * columns will not draw a bar. Every numeric attribute carries a `MinValue` and
 * a `MaxValue` whether or not anyone thought about them, and the defaults span
 * the whole numeric type — so a credit limit of 40,000 against a default
 * maximum of one hundred billion draws a bar four ten-thousandths of a pixel
 * wide, on every row, for every record. A bar nobody can see is worse than no
 * bar, because the column still looks customized.
 *
 * Both ends must differ from the default before a domain counts as declared. A
 * domain is two numbers; if either end is the platform's placeholder then
 * nobody has said what this column's range is, and picking one — clamping a
 * default minimum to zero, say — would be this control inventing the domain it
 * exists to read.
 *
 * The constants are from the Dataverse attribute-metadata documentation and
 * have NOT been read back off a real environment. They are the one thing here
 * whose being wrong is invisible: a wrong constant means bars quietly appear on
 * columns that declare nothing, or quietly vanish from columns that do. Confirm
 * them against a real table before release — SPEC.md, "Not verified".
 */
function isPlatformDefault(
    min: number,
    max: number,
    dataType: ColumnDataType,
): boolean {
    const defaults = PLATFORM_DEFAULTS[dataType];

    if (!defaults) {
        return false;
    }

    return min === defaults.min && max === defaults.max;
}

const PLATFORM_DEFAULTS: Partial<Record<ColumnDataType, Bounds>> = {
    Integer: { min: -2147483648, max: 2147483647 },
    Decimal: { min: -100000000000, max: 100000000000 },
    FloatingPoint: { min: -100000000000, max: 100000000000 },
    Currency: { min: -922337203685477, max: 922337203685477 },
};

/**
 * Which table this grid is showing.
 *
 * A customizer binds no dataset — its only property is the event name the host
 * generates — so unlike every other control shape there is no
 * `dataset.getTargetEntityType()` to ask. Both candidates below are cast
 * through because `@types/powerapps-component-framework` declares neither:
 * `interface Mode` has `allocatedHeight`, `allocatedWidth`,
 * `isControlDisabled`, `isVisible`, `label` and three methods, and there is no
 * `page` on the context at all. That is the same lag that hides
 * `factory.fireEvent`, so an absent type here is not evidence of an absent API.
 *
 * `contextInfo` first because it is the current one; `page` is its predecessor
 * and is kept as a fallback rather than as a preference. If neither carries a
 * name on a real grid, this control has no domain source and the design has to
 * change rather than be worked around — see SPEC.md.
 */
function entityLogicalName(
    context: ComponentFramework.Context<unknown>,
): string | undefined {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const loose = context as any;

    const candidates = [
        loose.mode?.contextInfo?.entityTypeName,
        loose.page?.entityTypeName,
    ];
    /* eslint-enable @typescript-eslint/no-explicit-any */

    return candidates.find(
        (name): name is string => typeof name === 'string' && name !== '',
    );
}

/**
 * Drop everything this module is holding.
 *
 * Called from `destroy` when the last customizer on the page goes, matching how
 * `publishTheme`'s attribute is released. Module state outliving the control
 * that filled it would hand a second grid — on a different table — the first
 * one's metadata, and every column name that happened to collide would draw a
 * bar against the wrong domain.
 */
export function releaseBounds(): void {
    entityMetadata = undefined;
    requested = false;
}
