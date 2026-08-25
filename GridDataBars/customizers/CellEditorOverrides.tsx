import { CellEditorOverrides } from '../types';

/**
 * No editors, deliberately.
 *
 * This control draws a bar behind a value that is *not* being edited. The
 * moment a numeric cell opens for editing, the bar is gone by definition —
 * there is no value to be proportional to until the user commits one — so an
 * editor here would be this control reimplementing the grid's own numeric
 * editor for no gain, and inheriting every part of that contract it would then
 * have to get right: `charPress` staging, the `stopEditing` one-shot that stops
 * Escape committing through the blur handler, `secured`, `isRequired`,
 * `rowHeight`.
 *
 * The grid's numeric editor already handles all of it, against the same
 * attribute metadata this control reads for its range — including the
 * `MinValue`/`MaxValue` validation that makes the range meaningful in the first
 * place. Declining is not a gap to fill later; it is the correct answer for a
 * control whose whole subject is the read state of a cell.
 *
 * The export stays so `index.ts` has a stable shape to fire, and so that adding
 * an editor later is a change to this file rather than a change to the payload.
 */
export const cellEditorOverrides: CellEditorOverrides = {};
