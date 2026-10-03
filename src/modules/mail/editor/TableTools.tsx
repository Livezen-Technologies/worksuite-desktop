import { text } from '../../../core/i18n';
import type { MenuSection } from '../../../components/Menu';
import {
  alignCell,
  applyTableStyle,
  bordersOf,
  cellBackground,
  deleteColumn,
  deleteRow,
  deleteTable,
  hasHeader,
  insertColumn,
  insertRow,
  mergeCells,
  setBorderColour,
  setBorders,
  setTableWidth,
  splitCell,
  toggleHeader,
  type BorderMode,
  type TableStyle,
} from './emailHtml';
import { ToolbarRow, type ToolGroup } from './Toolbar';

/**
 * The table's own tools, shown while the caret is in a table
 * (worksuite-desktop#188): rows and columns in and out, merge and split,
 * the header row, cell colour, borders, alignment, width and a style.
 * Every change is made with inline styles and table attributes (emailHtml).
 */

export const CELL_COLOURS: ReadonlyArray<readonly [string, string]> = [
  ['#f1f3f4', 'Light grey'],
  ['#fef7e0', 'Light yellow'],
  ['#e6f4ea', 'Light green'],
  ['#e8f0fe', 'Light blue'],
  ['#fce8e6', 'Light red'],
  ['#f3e8fd', 'Light purple'],
  ['#1a56db', 'Blue'],
  ['#202124', 'Black'],
];

export const BORDER_COLOURS: ReadonlyArray<readonly [string, string]> = [
  ['#cccccc', 'Grey'],
  ['#202124', 'Black'],
  ['#1a56db', 'Blue'],
  ['#188038', 'Green'],
  ['#c5221f', 'Red'],
];

export function TableTools({ cell, onChanged }: { cell: HTMLTableCellElement; onChanged: (caret?: HTMLTableCellElement | null) => void }) {
  const table = cell.closest('table') as HTMLTableElement;
  const header = hasHeader(table);
  const borders = bordersOf(table);
  const merged = Math.max(1, cell.colSpan) > 1 || Math.max(1, cell.rowSpan) > 1;
  const act = (fn: () => HTMLTableCellElement | null | void) => () => {
    const next = fn();
    onChanged(next === undefined ? cell : next);
  };
  const h = (cell.style.textAlign || cell.getAttribute('align') || 'left') as 'left' | 'center' | 'right';
  const v = (cell.style.verticalAlign || cell.getAttribute('valign') || 'top') as 'top' | 'middle' | 'bottom';

  const deleteMenu = (): MenuSection[] => [
    {
      id: 'delete',
      items: [
        { id: 'del-row', label: text('Delete row'), icon: 'rows', onSelect: act(() => deleteRow(cell)) },
        { id: 'del-col', label: text('Delete column'), icon: 'columns', onSelect: act(() => deleteColumn(cell)) },
        { id: 'del-table', label: text('Delete table'), icon: 'trash', danger: true, onSelect: act(() => (deleteTable(cell), null)) },
      ],
    },
  ];
  const mergeMenu = (): MenuSection[] => [
    {
      id: 'merge',
      items: [
        { id: 'merge-right', label: text('Merge with the cell on the right'), icon: 'cells-merge', onSelect: act(() => void mergeCells(cell, 'right')) },
        { id: 'merge-down', label: text('Merge with the cell below'), icon: 'cells-merge', onSelect: act(() => void mergeCells(cell, 'down')) },
        { id: 'split', label: text('Split cell'), icon: 'cells-split', disabled: !merged, reason: text('Only a merged cell can be split.'), onSelect: act(() => void splitCell(cell)) },
      ],
    },
  ];
  const colourMenu = (): MenuSection[] => [
    {
      id: 'bg',
      label: text('Cell colour'),
      items: [
        ...CELL_COLOURS.map(([c, name]) => ({ id: `bg-${c}`, label: text(name), radio: true, checked: (cell.getAttribute('bgcolor') ?? '').toLowerCase() === c, onSelect: act(() => cellBackground([cell], c)) })),
        { id: 'bg-none', label: text('No colour'), onSelect: act(() => cellBackground([cell], null)) },
      ],
    },
  ];
  const borderMenu = (): MenuSection[] => [
    {
      id: 'mode',
      label: text('Borders'),
      items: (
        [
          ['all', text('All borders')],
          ['outside', text('Outside border')],
          ['none', text('No borders')],
        ] as Array<[BorderMode, string]>
      ).map(([m, label]) => ({ id: `b-${m}`, label, radio: true, checked: borders === m, onSelect: act(() => setBorders(table, m)) })),
    },
    { id: 'colour', label: text('Border colour'), items: BORDER_COLOURS.map(([c, name]) => ({ id: `bc-${c}`, label: text(name), onSelect: act(() => setBorderColour(table, c)) })) },
  ];
  const alignMenu = (): MenuSection[] => [
    {
      id: 'h',
      label: text('Across'),
      items: (
        [
          ['left', text('Left'), 'align-left'],
          ['center', text('Centre'), 'align-center'],
          ['right', text('Right'), 'align-right'],
        ] as const
      ).map(([a, label, icon]) => ({ id: `h-${a}`, label, icon, radio: true, checked: h === a, onSelect: act(() => alignCell([cell], a)) })),
    },
    {
      id: 'v',
      label: text('Down'),
      items: (
        [
          ['top', text('Top')],
          ['middle', text('Middle')],
          ['bottom', text('Bottom')],
        ] as const
      ).map(([a, label]) => ({ id: `v-${a}`, label, radio: true, checked: v === a, onSelect: act(() => alignCell([cell], undefined, a)) })),
    },
  ];
  const widthMenu = (): MenuSection[] => [
    {
      id: 'w',
      items: [
        { id: 'w-fit', label: text('Fit to content'), radio: true, checked: !table.getAttribute('width'), onSelect: act(() => setTableWidth(table, 'fit')) },
        { id: 'w-full', label: text('Full width'), radio: true, checked: table.getAttribute('width') === '100%', onSelect: act(() => setTableWidth(table, 'full')) },
      ],
    },
  ];
  const styleMenu = (): MenuSection[] => [
    {
      id: 's',
      items: (
        [
          ['plain', text('Plain')],
          ['bordered', text('Bordered')],
          ['striped', text('Striped rows')],
          ['header', text('Coloured header')],
        ] as Array<[TableStyle, string]>
      ).map(([s, label]) => ({ id: `s-${s}`, label, onSelect: act(() => applyTableStyle(table, s)) })),
    },
  ];

  const groups: ToolGroup[] = [
    {
      id: 'insert',
      label: text('Rows and columns'),
      items: [
        { id: 't-row-above', label: text('Insert row above'), icon: 'row-above', run: act(() => (insertRow(cell, 'above'), cell)) },
        { id: 't-row-below', label: text('Insert row below'), icon: 'row-below', run: act(() => (insertRow(cell, 'below'), cell)) },
        { id: 't-col-left', label: text('Insert column left'), icon: 'col-left', run: act(() => (insertColumn(cell, 'left'), cell)) },
        { id: 't-col-right', label: text('Insert column right'), icon: 'col-right', run: act(() => (insertColumn(cell, 'right'), cell)) },
        { id: 't-delete', label: text('Delete'), icon: 'trash', menu: deleteMenu },
      ],
    },
    {
      id: 'cells',
      label: text('Cells'),
      items: [
        { id: 't-merge', label: text('Merge or split cells'), icon: 'cells-merge', menu: mergeMenu },
        { id: 't-header', label: text('Header row'), icon: 'panel-top', active: header, run: act(() => void toggleHeader(table)) },
        { id: 't-colour', label: text('Cell colour'), icon: 'paint-bucket', menu: colourMenu },
        { id: 't-borders', label: text('Borders'), icon: 'frame', menu: borderMenu },
        { id: 't-align', label: text('Cell alignment'), icon: h === 'center' ? 'align-center' : h === 'right' ? 'align-right' : 'align-left', menu: alignMenu },
      ],
    },
    {
      id: 'table',
      label: text('Table'),
      items: [
        { id: 't-width', label: text('Table width'), icon: 'columns', menu: widthMenu },
        { id: 't-style', label: text('Table style'), icon: 'table-properties', menu: styleMenu },
      ],
    },
  ];
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line bg-subtle/60 px-2 py-1">
      <span className="shrink-0 pl-1 text-[12px] font-semibold text-ink-3">{text('Table')}</span>
      <ToolbarRow groups={groups} label={text('Table tools')} size="sm" className="min-w-0 flex-1" />
    </div>
  );
}
