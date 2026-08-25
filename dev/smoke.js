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
 * The ranges the stubbed metadata declares.
 *
 * `unbounded` carries the Dataverse default range for a decimal, which is the
 * case this control is built to decline — and the one most likely to regress
 * quietly, since a control that stopped declining would simply start drawing
 * invisible bars on every numeric column in the environment.
 */
const BOUNDS = {
    creditlimit: { MinValue: 0, MaxValue: 250000 },
    variance: { MinValue: -50, MaxValue: 50 },
    unbounded: { MinValue: -100000000000, MaxValue: 100000000000 },
};

let payload = null;

const context = {
    parameters: { EventName: { raw: 'smoke-event' } },
    factory: {
        fireEvent: (name, fired) => {
            payload = fired;
        },
        requestRender() {},
    },
    utils: {
        // `.get()` rather than a plain object, because that is the shape the
        // platform returns — the public surface is prototype getters and a
        // Map-like Attributes collection. A plain object here would let a
        // control that walked it with Object.keys pass this file and fail on a
        // real grid.
        getEntityMetadata: () =>
            Promise.resolve({ Attributes: { get: (column) => BOUNDS[column] } }),
    },
    mode: { contextInfo: { entityTypeName: 'account' } },
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

const colDefs = [
    { name: 'creditlimit', dataType: 'Currency', isPrimary: false },
    { name: 'variance', dataType: 'Decimal', isPrimary: false },
    { name: 'unbounded', dataType: 'Decimal', isPrimary: false },
];

/*
 * A tick, because the bounds resolve from a promise. On a real grid nothing
 * waits like this — which is exactly the risk recorded in SPEC.md: if the
 * metadata has not landed by the first paint, every cell declines and the bars
 * appear only on the next natural re-render.
 */
setTimeout(() => {
    const renderers = (payload && payload.cellRendererOverrides) || {};

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
