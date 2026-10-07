import { useMemo } from 'react';

interface TrendChartProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  label?: string;
  currentValue?: number;
  changePercent?: number;
}

export function TrendChart({ data, width = 200, height = 60, color = 'hsl(var(--primary))', label, currentValue, changePercent }: TrendChartProps) {
  const { linePath, areaPath, points } = useMemo(() => {
    const pts: Array<{ x: number; y: number }> = [];
    let line = '';
    if (data.length >= 2) {
      const max = Math.max(...data, 1);
      const min = Math.min(...data, 0);
      const range = max - min || 1;
      const stepX = width / (data.length - 1);
      pts.push(...data.map((val, i) => {
        const x = i * stepX;
        const y = height - ((val - min) / range) * (height - 4) - 2;
        return { x, y };
      }));
      line = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
    }
    // 面积路径：折线下填充到图表底部
    let area = '';
    if (pts.length >= 2) {
      const bottom = height - 1;
      area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${bottom} L${pts[0].x.toFixed(1)},${bottom} Z`;
    }
    return { linePath: line, areaPath: area, points: pts };
  }, [data, width, height]);

  if (data.length < 2) {
    return (
      <div className="flex flex-col gap-1">
        {label && <span className="text-caption text-muted-foreground">{label}</span>}
        <div className="flex items-end gap-2">
          {currentValue !== undefined && <span className="text-xl font-bold">{currentValue}</span>}
          {changePercent !== undefined && (
            <span className={changePercent >= 0 ? 'text-defeat text-xs' : 'text-victory text-xs'}>
              {changePercent >= 0 ? '+' : ''}{changePercent}%
            </span>
          )}
        </div>
        <svg width={width} height={height} className="overflow-visible">
          <text x={width / 2} y={height / 2 + 4} textAnchor="middle" className="fill-muted-foreground text-xs">数据不足</text>
        </svg>
      </div>
    );
  }

  // 3 条虚线水平网格（25% / 50% / 75%）
  const gridLines = [0.25, 0.5, 0.75].map((f) => ({ y: height - f * (height - 4) - 2, key: f }));

  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-caption text-muted-foreground">{label}</span>}
      <div className="flex items-end gap-2">
        {currentValue !== undefined && <span className="text-xl font-bold">{currentValue}</span>}
        {changePercent !== undefined && (
          <span className={changePercent >= 0 ? 'text-defeat text-xs' : 'text-victory text-xs'}>
            {changePercent >= 0 ? '+' : ''}{changePercent}%
          </span>
        )}
      </div>
      <svg width={width} height={height} className="overflow-visible">
        <defs>
          <linearGradient id={`trend-fill-${color.replace(/[^a-zA-Z0-9]/g, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {gridLines.map((g) => (
          <line key={g.key} x1="0" y1={g.y} x2={width} y2={g.y} stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="3 4" />
        ))}
        {areaPath && <path d={areaPath} fill={`url(#trend-fill-${color.replace(/[^a-zA-Z0-9]/g, '')})`} />}
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={color} stroke="hsl(var(--background))" strokeWidth="1.5" />
        ))}
      </svg>
    </div>
  );
}
