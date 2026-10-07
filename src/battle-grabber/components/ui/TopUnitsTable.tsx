import type { TopUnitSummary } from "../../types";
import { formatCount } from "../../utils/format";

export function TopUnitsTable(props: { rows: TopUnitSummary[] }): JSX.Element {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="border-b border-border bg-card px-3 py-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">兵力变化单位</p>
      </div>
      {props.rows.length === 0 ? (
        <p className="px-3 py-10 text-center text-sm text-muted-foreground">当前报告没有可用的兵力变化摘要。</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="bg-card text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">单位</th>
              <th className="px-3 py-2 text-right">承伤</th>
              <th className="px-3 py-2 text-right">治疗</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.slice(0, 12).map((row) => (
              <tr key={row.unit} className="border-t border-border/80">
                <td className="px-3 py-2 text-foreground">{row.unit}</td>
                <td className="px-3 py-2 text-right text-defeat">{formatCount(row.taken)}</td>
                <td className="px-3 py-2 text-right text-victory">{formatCount(row.healed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
