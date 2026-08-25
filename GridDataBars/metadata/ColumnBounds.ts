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
 * Column types whose values are numbers with a declarable range.
 *
 * Lives here rather than beside the renderer overrides that consume it because
 * it is the same list three times over: the types that get a bar are exactly
 * the types that have a domain to be proportional to, which are exactly the
 * keys of `METADATA_TYPE` and of `PLATFORM_DEFAULTS` below. Copies would drift,
 * and the failure would be silent — a type in one list and not another either
 * asks the platform for metadata it never draws, or draws bars against a
 * default range.
 *
 * `Duration` is deliberately absent. Its raw value is a count of minutes and
 * its metadata range describes that count, so a bar drawn from it would be
 * proportional to something the cell does not display — the cell reads
 * "1 hour" and the bar measures 60. That is renderer rule 3, and the fix is not
 * a formatting change: durations are read as durations, not as positions in a
 * range, so the visual does not fit the column even where the numbers do.
 */
export const NUMERIC_TYPES: ColumnDataType[] = [
    'Integer',
    'Decimal',
    'FloatingPoint',
    'Currency',
];

/**
 * The metadata entity each numeric type's range lives on.
 *
 * A range is not on the attribute metadata every column shares; it is on the
 * *typed* entity, and the attribute collection has to be cast to that type
 * before `MinValue` can even be named in a `$select`. A cast is per request, so
 * four types are four requests and there is no way to make it one.
 *
 * In exchange each answers for every column of its type on the table at once,
 * which is what lets this run before a single cell has been drawn.
 */
const METADATA_TYPE: Partial<Record<ColumnDataType, string>> = {
    Integer: 'IntegerAttributeMetadata',
    Decimal: 'DecimalAttributeMetadata',
    FloatingPoint: 'DoubleAttributeMetadata',
    Currency: 'MoneyAttributeMetadata',
};

/**
 * Every numeric attribute the table declares, by logical name.
 *
 * Module scope rather than instance scope because the renderers are plain
 * functions the grid holds, not methods: by the time a cell asks for bounds,
 * the control instance is not on the call stack. One grid gets one customizer,
 * so there is one table to describe.
 */
const attributes = new Map<string, unknown>();

/** Which numeric type's request each of those came from — for `report` only. */
const columnTypes = new Map<string, ColumnDataType>();

/** Whether every request has settled — see `isResolved`. */
let resolved = false;

/** Whether a resolve has been started, successfully or not. */
let requested = false;

/**
 * Cells that mounted before the answer arrived, waiting to hear that it has.
 *
 * The reason this exists is a platform behaviour that had to be observed to be
 * believed: **re-firing the customizer event does not make the grid repaint.**
 * The obvious way to handle a late answer is to hand the grid a fresh payload
 * and let it redraw; the grid takes the payload and draws nothing new, and the
 * bars appear only when something else invalidates a cell — clicking it, for
 * instance. So the update has to come from inside the cells themselves, which
 * are React elements this control owns and can therefore make re-render.
 */
const listeners = new Set<() => void>();

/**
 * Invalidates in-flight responses across a `releaseBounds`.
 *
 * A page can swap one customized grid for another on a different table. Without
 * this, the first table's answer could land after the second grid started and
 * fill the map with ranges belonging to the wrong entity — and a *wrong* bar is
 * worse than a missing one, because nothing about it looks wrong.
 */
let generation = 0;

/**
 * Read every range this table declares, once.
 *
 * Called from both `init` and `updateView`, and latched, for the same reason
 * `fire()` is: the context's bound properties are not guaranteed to carry
 * anything by the time `init` runs, so a single attempt there can miss
 * permanently. It does not latch on failure — a missing entity name is retried
 * on the next render, exactly as a missing event name is.
 *
 * **This runs before any cell exists, and that is the whole point.** Two
 * earlier versions of this module could not: they read metadata through
 * `context.utils.getEntityMetadata`, which answers only for columns named in
 * the call, and a customizer does not learn its column names until the grid
 * asks it to draw a cell. Starting from the first render meant the answer
 * always arrived after the first paint, and — with no way to force a repaint —
 * the bars did not appear until the user touched something. Reading the same
 * ranges from the Web API needs only the *table* name, which `init` has, so
 * the request can win the race instead of always losing it.
 *
 * Four requests rather than one, and unfiltered rather than scoped to the
 * columns on screen. Both fall out of running this early: the cast that makes
 * `MinValue` readable is per type, and there is no column list yet to narrow
 * by. It buys a table-wide answer that is already in hand when the first cell
 * mounts, and it stays correct when the user adds a column to the view.
 *
 * Returns `void` rather than the promise. Nothing can be awaited usefully — the
 * renderers are synchronous and the grid owns the render schedule — and a
 * failure is indistinguishable from a table that declares no ranges, which the
 * control already draws correctly.
 */
export function resolveBounds(context: ComponentFramework.Context<unknown>): void {
    if (requested) {
        return;
    }

    const entity = entityLogicalName(context);

    if (!entity || typeof fetch !== 'function') {
        // Canvas, a preview harness, or anywhere else with no table behind it.
        return;
    }

    requested = true;

    const url = clientUrl(context);
    const era = generation;

    Promise.all(
        NUMERIC_TYPES.map((dataType) => fetchType(url, entity, dataType, era)),
    ).then(() => {
        if (era !== generation) {
            return;
        }

        resolved = true;

        report();

        // Every cell drawn while this was in flight declined, and nothing in
        // the customizer contract can ask the grid to draw them again.
        for (const listener of [...listeners]) {
            listener();
        }
    });
}

/**
 * Read every range the table declares for one numeric type.
 *
 * Through `fetch` rather than `context.webAPI`, which addresses records by
 * entity logical name and has no way to reach `EntityDefinitions` — and through
 * the Web API rather than `context.utils.getEntityMetadata`, which is the
 * obvious call and does not carry the answer. Its attribute metadata exposes
 * `AttributeType`, `DisplayName`, `EntityLogicalName` and `LogicalName`, plus
 * option-set extras for the choice-shaped types, and that is all: `MinValue`
 * and `MaxValue` read `undefined` on a real decimal column that has both set in
 * the table designer.
 *
 * Never rejects. A failed lookup and a column that declares no range produce
 * the same output, so there is nothing for a caller to handle differently.
 *
 * https://learn.microsoft.com/power-apps/developer/data-platform/webapi/query-metadata-web-api
 */
function fetchType(
    clientUrlPrefix: string,
    entity: string,
    dataType: ColumnDataType,
    era: number,
): Promise<void> {
    const cast = METADATA_TYPE[dataType];

    if (!cast) {
        return Promise.resolve();
    }

    const url =
        `${clientUrlPrefix}/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(entity)}')` +
        `/Attributes/Microsoft.Dynamics.CRM.${cast}` +
        `?$select=LogicalName,MinValue,MaxValue`;

    trace(url);

    return fetch(url, {
        // Same origin as the app, so the session authenticates the request and
        // there is no token to acquire. Reading metadata needs no privilege
        // beyond being signed in.
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            'OData-MaxVersion': '4.0',
            'OData-Version': '4.0',
        },
    })
        .then((response) => (response.ok ? response.json() : undefined))
        .then((body) => {
            if (era !== generation) {
                return;
            }

            const records: unknown[] = body?.value ?? [];

            for (const record of records) {
                const attribute = record as { LogicalName?: unknown };

                if (typeof attribute.LogicalName === 'string') {
                    attributes.set(attribute.LogicalName, attribute);

                    // The type is not among the three properties selected, and
                    // `report` needs it to say which platform default a range
                    // was compared against. Recorded from the request rather
                    // than read back off the response: a cast collection is
                    // homogeneous, so the server is free to omit the
                    // `@odata.type` annotation that would otherwise carry it.
                    columnTypes.set(attribute.LogicalName, dataType);
                }
            }
        })
        .catch(() => {
            // Offline, signed out, or a host that is not a Dataverse app at
            // all. Every column then misses its bounds, which draws the grid's
            // own cells — the same output as a table that declares no ranges.
        });
}

/**
 * Whether the answer is in, whatever the answer turned out to be.
 *
 * This is what lets a renderer tell "no range on this column" apart from "not
 * yet", which are the same `undefined` from `boundsFor` and want opposite
 * handling: the first declines for good and hands the cell back to the grid,
 * the second has to keep the cell and wait. Failure counts as resolved — a
 * request that could not be made is not going to be answered later.
 */
export function isResolved(): boolean {
    return resolved;
}

/**
 * Hear about it when the ranges arrive. Returns its own unsubscribe.
 *
 * For cells that mounted first. See `listeners` for why a React subscription is
 * doing a job that looks like it should belong to the grid.
 */
export function subscribeToBounds(listener: () => void): () => void {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

/**
 * The declared domain for one column, or `undefined` if it has none.
 *
 * Synchronous, because the thing calling it is a cell renderer and the contract
 * gives those no way to wait. Ask `isResolved` to tell an absent range apart
 * from an answer that has not landed.
 *
 * No memoisation of the arithmetic below, and that is deliberate: the work
 * saved would be one map lookup and four property reads.
 */
export function boundsFor(
    column: string,
    dataType: ColumnDataType,
): Bounds | undefined {
    const attribute = metadataFor(column);

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

interface NumericAttributeMetadata {
    readonly MinValue?: unknown;
    readonly MaxValue?: unknown;
}

function metadataFor(column: string): NumericAttributeMetadata | undefined {
    return attributes.get(column) as NumericAttributeMetadata | undefined;
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
 * them against a real table before release — SPEC.md, "Not verified", and
 * `report` below is the fastest way to do it.
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

/**
 * Read off a real environment, not off the documentation.
 *
 * Four columns were created on a table through the modern designer with their
 * Minimum and Maximum left alone, and their metadata read back through the Web
 * API. Three matched what the documentation implied. `FloatingPoint` did not:
 * a fresh float column carries `0..1000000000`, not the ±100 billion its type
 * *accepts*. The wrong constant meant every unconfigured float column in an
 * environment drew a bar — one whose width rounds to nothing, on every row,
 * which is the exact failure `isPlatformDefault` exists to prevent.
 */
const PLATFORM_DEFAULTS: Partial<Record<ColumnDataType, Bounds>> = {
    Integer: { min: -2147483648, max: 2147483647 },
    Decimal: { min: -100000000000, max: 100000000000 },
    FloatingPoint: { min: 0, max: 1000000000 },
    Currency: { min: -922337203685477, max: 922337203685477 },
};

/**
 * Say what came back and what this control decided about it, on request.
 *
 * Silent unless someone sets the flag from a console before the grid loads:
 *
 *     window.gridDataBarsDebug = true
 *
 * It exists because every way this control can fail looks identical from the
 * grid. A column with no bar might be a column that declares nothing, a column
 * whose metadata never arrived, a name that is not an attribute, or a
 * `PLATFORM_DEFAULTS` constant that is wrong — and all four draw an ordinary
 * cell. This prints which one it was, per column, and `trace` prints the
 * requests behind it so they can be pasted into a browser and read directly.
 *
 * Every numeric column on the table is listed, not just the ones on the view,
 * because that is what the requests returned — and because a column left at its
 * defaults is the only way to read what this environment's defaults actually
 * are.
 */
function report(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(globalThis as any).gridDataBarsDebug) {
        return;
    }

    const rows: Record<string, unknown>[] = [];

    for (const [column, record] of attributes) {
        const attribute = record as NumericAttributeMetadata;
        const dataType = columnTypes.get(column);

        rows.push({
            column,
            dataType,
            MinValue: attribute?.MinValue,
            MaxValue: attribute?.MaxValue,
            platformDefault: defaultFor(dataType),
            bar: barVerdict(attribute, dataType && boundsFor(column, dataType)),
        });
    }

    // eslint-disable-next-line no-console
    console.table(rows);
}

/**
 * The range this control believes the platform assigns when nobody chooses.
 *
 * Printed beside every column so the constant and the observation sit in the
 * same row: a column left at its defaults whose range does *not* match this is
 * the constant being wrong, and that is the one thing here that nothing else
 * can tell you. See SPEC.md, "Not verified".
 */
function defaultFor(dataType: ColumnDataType | undefined): string {
    const defaults = dataType && PLATFORM_DEFAULTS[dataType];

    return defaults ? `${defaults.min}..${defaults.max}` : '';
}

function barVerdict(
    attribute: NumericAttributeMetadata | undefined,
    bounds: Bounds | undefined,
): string {
    if (bounds) {
        return `yes, scaled to ${bounds.min}..${bounds.max}`;
    }

    if (!attribute) {
        return 'no — the platform returned no metadata for this column';
    }

    if (
        typeof attribute.MinValue !== 'number' ||
        typeof attribute.MaxValue !== 'number'
    ) {
        return 'no — this metadata carries no MinValue/MaxValue';
    }

    return 'no — the declared range is empty, inverted, or the platform default';
}

function trace(url: string): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(globalThis as any).gridDataBarsDebug) {
        return;
    }

    // eslint-disable-next-line no-console
    console.log('[GridDataBars]', url);
}

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
 * and is kept as a fallback rather than as a preference. Confirmed on a real
 * model-driven grid: `mode.contextInfo.entityTypeName` carries the logical name
 * and the metadata request built from it returns the table's ranges.
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
 * Where the Dataverse Web API lives, or `''` for "same place as this page".
 *
 * A model-driven app and its Web API are the same origin, so a relative URL is
 * correct wherever this control is supposed to run — but not where the
 * organisation sits in a *path* rather than a host, which is the on-premises
 * layout (`https://server/orgname/main.aspx`). There a root-relative request
 * misses the org segment and 404s, so the platform's own answer is preferred
 * when there is one.
 *
 * `page.getClientUrl` is cast through for the same reason the entity name is.
 * The global `Xrm` behind it is a last resort rather than a preference — a PCF
 * control is not supposed to reach for it — but a wrong origin here means no
 * bars at all, and one property read is cheaper than that.
 */
function clientUrl(context: ComponentFramework.Context<unknown>): string {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const loose = context as any;
    const global = globalThis as any;

    const candidates = [
        loose.page?.getClientUrl?.(),
        global.Xrm?.Utility?.getGlobalContext?.()?.getClientUrl?.(),
    ];
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const found = candidates.find(
        (url): url is string => typeof url === 'string' && url !== '',
    );

    // Trailing slashes are inconsistent between the two sources, and the paths
    // built against this all start with one.
    return (found ?? '').replace(/\/+$/, '');
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
    // Ahead of clearing the map, so a response still in flight finds its era
    // stale and drops what it was about to write.
    generation++;

    attributes.clear();
    columnTypes.clear();
    listeners.clear();
    resolved = false;
    requested = false;
}
