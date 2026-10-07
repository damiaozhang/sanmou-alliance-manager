import type { SummaryPair } from "../../types";
import { formatCount } from "../../utils/format";

export function SummaryTable(props: { title: string; rows: SummaryPair[]; emptyText: string }): JSX.Element {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="border-b border-border bg-card px-3 py-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{props.title}</p>
      </div>
      {props.rows.length === 0 ? (
        <p className="px-3 py-10 text-center text-sm text-muted-foreground">{props.emptyText}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="bg-card text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">名称</th>
              <th className="px-3 py-2 text-right">次数</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.slice(0, 12).map((row) => (
              <tr key={`${props.title}:${row.label}`} className="border-t border-border/80">
                <td className="px-3 py-2 text-foreground">{row.label}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{formatCount(row.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
