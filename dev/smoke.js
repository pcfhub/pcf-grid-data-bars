/*
 * Drives the real built bundle outside a browser.
 *
 *     npm run build && npm run smoke
 *
 * What it does: stubs the globals the platform provides, loads
 * `out/controls/GridDataBars/bundle.js` exactly as the grid would, lets the
 * control fire its payload, then calls the cell renderers the way the grid
 * calls them and inspects the React elements that come back.
 *
 * Why it exists: this control's whole behaviour is a set of decisions taken per
 * cell — the bar geometry, and the four cases that decline — and every one of
 * them is invisible in `dev/harness.html` unless you happen to be looking at
 * the right cell with the right column bounds. Here they are assertions.
 *
 * Why no test framework: there is none in this repository, and adding one to
 * run eleven assertions against a bundle would be a dependency, a config file
 * and a second build pipeline for something `node` already does. It also runs
 * the **shipping bundle** rather than the TypeScript sources, which is the part
 * worth checking — webpack, the externals and the manifest all sit between the
 * source and what a grid actually loads.
 *
 * **What passing here does NOT mean.** Every value below is supplied by this
 * file. The metadata is a stub, so it proves the *geometry* and the decline
 * logic and says nothing about whether `getEntityMetadata` returns what this
 * control expects, whether `contextInfo.entityTypeName` exists, or whether the
 * platform default ranges in `PLATFORM_DEFAULTS` are right. Those are in
 * SPEC.md under "Not verified" and only a real model-driven grid settles them.
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Resolved from this file rather than from the working directory, so the script
// behaves the same run directly or through npm.
const root = path.join(__dirname, '..');
const React = require(path.join(root, 'node_modules', 'react'));

const BUNDLE = path.join(root, 'out', 'controls', 'GridDataBars', 'bundle.js');

if (!fs.existsSync(BUNDLE)) {
    console.error('\n  No bundle at out/controls/GridDataBars. Run npm run build first.\n');
    process.exit(1);
}

/* ----------------------------------------------------------- the platform */

global.Reactv16 = React;
global.self = global;
global.window = global;

// `publishTheme` writes a theme attribute to the document during init. Two
// methods are all it touches.
global.document = {
    documentElement: { setAttribute() {}, removeAttribute() {} },
};

let registered = null;

// Two arguments, not three: pcf-scripts emits
// registerControl('PCFHub.GridDataBars', ctor) with the name already joined.
global.ComponentFramework = {
    registerControl: (fullName, ctor) => {
        registered = ctor;
    },
};

/*
 * The table the stubbed Web API describes, keyed by the metadata type the
 * control has to cast the attribute collection to before `MinValue` and
 * `MaxValue` are readable at all.
 *
 * `unbounded` carries the Dataverse default range for a decimal, which is the
 * case this control is built to decline — and the one most likely to regress
 * quietly, since a control that stopped declining would simply start drawing
 * invisible bars on every numeric column in the environment.
 */
const ATTRIBUTES = {
    MoneyAttributeMetadata: [
        { LogicalName: 'creditlimit', MinValue: 0, MaxValue: 250000 },
        /*
         * The range Dataverse actually ships on `account.creditlimit`, under a
         * second name so both cases are covered at once.
         *
         * It is not the currency default, so no default check recognises it —
         * read off a real environment, along with `0..1000000000` on
         * `numberofemployees` and `-1..2147483647` on the timezone columns. A
         * realistic value against it computes a bar millionths of a cell wide.
         */
        {
            LogicalName: 'stockrange',
            MinValue: 0,
            MaxValue: 100000000000,
        },
    ],
    DecimalAttributeMetadata: [
        { LogicalName: 'variance', MinValue: -50, MaxValue: 50 },
        {
            LogicalName: 'unbounded',
            MinValue: -100000000000,
            MaxValue: 100000000000,
        },
    ],
};

let payload = null;
let firings = 0;

/** Every metadata URL this run requested. */
const metadataCalls = [];

/*
 * The Web API, as far as this control is concerned.
 *
 * A stub of `fetch` rather than of `context.utils.getEntityMetadata`, because
 * the control no longer calls that: the client API's attribute metadata
 * carries no `MinValue`/`MaxValue`, and the properties exist only on the typed
 * metadata entities the Web API can cast to. This answers only for the cast it
 * was actually given, which is what makes the assertions below meaningful — a
 * stub that answered every URL identically would pass a control that built the
 * wrong one.
 */
global.fetch = (url) => {
    metadataCalls.push(url);

    const cast = /Microsoft\.Dynamics\.CRM\.(\w+)/.exec(url);
    const value = (cast && ATTRIBUTES[cast[1]]) || [];

    return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ value }),
    });
};

const context = {
    parameters: { EventName: { raw: 'smoke-event' } },
    factory: {
        fireEvent: (name, fired) => {
            payload = fired;
            firings++;
        },
        requestRender() {},
    },
    mode: { contextInfo: { entityTypeName: 'account' } },
    page: { getClientUrl: () => 'https://contoso.crm.dynamics.com' },
    fluentDesignLanguage: { isDarkTheme: false },
};

vm.runInThisContext(fs.readFileSync(BUNDLE, 'utf8'), { filename: 'bundle.js' });

/* -------------------------------------------------------------- assertions */

const results = [];

function check(label, ok, detail) {
    results.push({ ok, label, detail });
}

check('bundle registered a control', typeof registered === 'function');

if (typeof registered !== 'function') {
    report();
}

const instance = new registered();

instance.init(context, () => {}, {}, {});
instance.updateView(context);

check('control fired a payload', payload !== null);

/*
 * The ordering the whole control turns on, asserted before anything renders.
 *
 * Two earlier versions read the ranges from `context.utils.getEntityMetadata`,
 * which answers only for columns named in the call — and a customizer does not
 * learn its column names until the grid asks it to draw a cell. The request
 * therefore could not start until after the first paint, and since nothing can
 * make the grid repaint, the bars appeared only when a cell was clicked. The
 * Web API needs only the table name, so the requests are already in flight
 * here, before a single renderer has been called.
 */
check(
    'asks for the ranges during init, before any cell is drawn',
    metadataCalls.length === 4,
    `${metadataCalls.length} request(s)`,
);

const colDefs = [
    { name: 'creditlimit', dataType: 'Currency', isPrimary: false },
    { name: 'variance', dataType: 'Decimal', isPrimary: false },
    { name: 'unbounded', dataType: 'Decimal', isPrimary: false },
    { name: 'stockrange', dataType: 'Currency', isPrimary: false },
];

const call = (renderers, type, value, columnIndex, extra) =>
    renderers[type](
        Object.assign(
            {
                value,
                formattedValue: String(value),
                columnDataType: type,
                isRightAligned: true,
                rowHeight: 42,
                validationError: null,
            },
            extra,
        ),
        { colDefs, columnIndex, rowData: { __rec_id: '1' }, allowTabKeyNavigation: false },
    );

/*
 * A cell drawn while the answers are still travelling.
 *
 * It must not decline. A declined cell is the grid's own and this control never
 * hears of it again, which is exactly how the "bars only appear when you click"
 * bug worked. It keeps the cell, shows the value, and upgrades itself when the
 * ranges land — so what comes back here is an element, and not a bar yet.
 */
const early = call((payload && payload.cellRendererOverrides) || {}, 'Currency', 125000, 0);

check('keeps the cell while the ranges are in flight', early !== undefined);

check(
    'draws no bar until it knows the range',
    early !== undefined && JSON.stringify(early).indexOf('GridDataBars-track') === -1,
);

/*
 * A tick, because the ranges resolve from a promise. On a real grid nothing
 * waits like this — the cells that mounted first find out through the
 * subscription rather than by being asked again.
 */
setTimeout(() => {
    const renderers = (payload && payload.cellRendererOverrides) || {};

    // Four numeric types, so four requests: the cast that makes MinValue
    // readable is per request, and each answers for every column of its type.
    check(
        'asks once per numeric type, not once per column',
        metadataCalls.length === 4,
        `${metadataCalls.length} request(s)`,
    );

    // The bug this file used to miss, in its current form. `MinValue` and
    // `MaxValue` cannot even be named in a `$select` until the collection is
    // cast, so a request without the cast returns attributes with no range on
    // them — which is exactly what the client API was doing.
    check(
        'casts the attribute collection to the typed metadata entity',
        metadataCalls.length > 0 &&
            metadataCalls.every((url) =>
                /\/Attributes\/Microsoft\.Dynamics\.CRM\.\w+AttributeMetadata\?/.test(
                    url,
                ),
            ),
        metadataCalls[0],
    );

    check(
        'selects the range, and scopes the query to this table',
        metadataCalls.every(
            (url) =>
                url.includes('$select=LogicalName,MinValue,MaxValue') &&
                url.includes("EntityDefinitions(LogicalName='account')"),
        ),
    );

    // Once, from init. Re-firing was tried as a way to make the grid repaint
    // for a late answer; the grid takes the payload and draws nothing new, so
    // the mechanism is gone and this guards its return.
    check(
        'hands the grid its payload exactly once',
        firings === 1,
        `${firings} firing(s)`,
    );

    const call = (type, value, columnIndex, extra) =>
        renderers[type](
            Object.assign(
                {
                    value,
                    formattedValue: String(value),
                    columnDataType: type,
                    isRightAligned: true,
                    rowHeight: 42,
                    validationError: null,
                },
                extra,
            ),
            { colDefs, columnIndex, rowData: { __rec_id: '1' }, allowTabKeyNavigation: false },
        );

    // The bar is the first child's only child: cell > track > bar.
    const barOf = (element) => element && element.props.children[0].props.children;

    check(
        'overrides exactly the four numeric types',
        ['Integer', 'Decimal', 'FloatingPoint', 'Currency'].every(
            (type) => typeof renderers[type] === 'function',
        ) && Object.keys(renderers).length === 4,
        Object.keys(renderers).join(', '),
    );

    check(
        'sends no cell editors',
        Object.keys((payload && payload.cellEditorOverrides) || {}).length === 0,
    );

    const midpoint = barOf(call('Currency', 125000, 0));

    check(
        'the midpoint of 0..250000 is a 50% bar from the left edge',
        midpoint && midpoint.props.style.left === '0%' && midpoint.props.style.width === '50%',
        midpoint && JSON.stringify(midpoint.props.style),
    );

    // The case a left-anchored bar gets wrong: -25 in -50..50 must run leftward
    // from the centre, not rightward from the edge as a 25%-wide positive.
    const negative = barOf(call('Decimal', -25, 1));

    check(
        'a negative value runs left from the zero baseline',
        negative && negative.props.style.left === '25%' && negative.props.style.width === '25%',
        negative && JSON.stringify(negative.props.style),
    );

    check(
        'a negative bar carries its own class',
        negative && /GridDataBars-negative/.test(negative.props.className),
    );

    check(
        'a value above the declared maximum clamps to a full bar',
        barOf(call('Currency', 999999, 0)).props.style.width === '100%',
    );

    check('declines a column whose range is the platform default', call('Decimal', 5, 2) === undefined);

    // A declared range that no default check can recognise, against a value a
    // real record would hold: 40,000 of 100 billion is 0.00004% of the track,
    // which rounds away to nothing. Drawing it would announce "0% of column
    // range" on a column nobody customized.
    check(
        'declines when the bar would round away to nothing',
        call('Currency', 40000, 3) === undefined,
    );

    // The same column, at a value that does fill some of the track. The
    // suppression above is per cell, so this must still draw.
    check(
        'still draws where that column holds a value big enough to see',
        barOf(call('Currency', 30000000000, 3)) !== undefined,
        barOf(call('Currency', 30000000000, 3)) &&
            JSON.stringify(barOf(call('Currency', 30000000000, 3)).props.style),
    );
    check('declines an unset value', call('Currency', null, 0) === undefined);
    check(
        'declines a cell carrying a validation error',
        call('Currency', 125000, 0, { validationError: new Error('invalid') }) === undefined,
    );

    const labelled = call('Currency', 125000, 0);

    check(
        'the accessible label carries the proportion, not just the value',
        /50% of column range/.test(labelled.props['aria-label']),
        labelled.props['aria-label'],
    );

    /*
     * The interactions the replaced cell was carrying.
     *
     * An element returned from a renderer replaces the grid's own cell *and its
     * behaviour*. Row selection survives because the grid owns the row, so the
     * cell still highlights and takes a focus ring and looks completely alive —
     * while being unable to open an editor. Nothing about that is visible in a
     * screenshot or a rendered harness, which is why it is asserted here.
     */
    let clicked = 0;
    let editing = 0;

    const interactive = call('Currency', 125000, 0, {
        columnEditable: true,
        onCellClicked: () => {
            clicked++;
        },
        startEditing: () => {
            editing++;
        },
    });

    interactive.props.onClick?.();
    interactive.props.onDoubleClick?.();

    check('forwards the click the grid needs to hear about', clicked === 1);
    check('opens the editor on double-click when the column is editable', editing === 1);

    const readOnly = call('Currency', 125000, 0, {
        columnEditable: false,
        startEditing: () => {
            editing++;
        },
    });

    check(
        'offers no edit gesture on a column that is not editable',
        readOnly.props.onDoubleClick === undefined,
    );

    report();
}, 20);

function report() {
    const failed = results.filter((result) => !result.ok);

    for (const result of results) {
        const detail = result.detail ? `  — ${result.detail}` : '';

        console.log(`  ${result.ok ? 'ok  ' : 'FAIL'}  ${result.label}${detail}`);
    }

    console.log(
        failed.length > 0
            ? `\n  ${failed.length} of ${results.length} failed\n`
            : `\n  ${results.length} passed — geometry and decline paths only; see SPEC.md for what a real grid still has to confirm\n`,
    );

    process.exit(failed.length > 0 ? 1 : 0);
}
