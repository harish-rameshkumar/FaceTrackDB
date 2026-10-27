import { cx } from "./cx";
import { EmptyState } from "./EmptyState";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  /** extra classes for the cell, e.g. "whitespace-nowrap" */
  className?: string;
}

/**
 * A data table that stays usable at phone width: from 640px up it is a normal table with a header
 * row; below that each row becomes a small card and every cell is prefixed with its column name
 * (see the .dt rules in globals.css). A wide table never makes the page scroll sideways.
 */
export function DataTable<T>({ columns, rows, rowKey, caption, empty, rowClassName }: {
  columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string | number; caption?: string; empty?: React.ReactNode; rowClassName?: (row: T) => string | undefined;
}) {
  if (rows.length === 0) return <>{empty ?? <EmptyState title="Nothing to show" />}</>;
  return (
    <table className="dt">
      {caption && <caption className="sr-only">{caption}</caption>}
      <thead>
        <tr>{columns.map((c) => <th key={c.key} scope="col">{c.header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)} className={rowClassName?.(row)}>
            {columns.map((c) => <td key={c.key} data-label={c.header} className={cx(c.className)}>{c.render(row)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
