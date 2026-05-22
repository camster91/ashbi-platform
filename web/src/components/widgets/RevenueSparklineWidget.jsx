import { TrendingUp, DollarSign } from 'lucide-react';
import { Card } from '../ui';

export default function RevenueSparklineWidget({ data = [] }) {
  if (!data?.length) return null;

  const max = Math.max(...data.map(d => d.total), 1);
  const total = data.reduce((sum, d) => sum + d.total, 0);
  const avg = total / data.length;

  const width = data.length * 20;
  const height = 60;
  const points = data.map((d, i) => ({
    x: i * 20,
    y: height - (d.total / max) * 50
  }));

  const areaPoints = [
    [0, height],
    ...points.map(p => [p.x, p.y]),
    [width, height]
  ].map(p => p.join(',')).join(' ');

  const linePoints = points.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <Card>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-500" />
          <h2 className="font-semibold text-foreground">Revenue Trend</h2>
        </div>
        <span className="text-xs font-bold text-emerald-600">${total.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
      </div>
      <div className="p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-16 overflow-visible">
          <defs>
            <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10B981" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Area fill */}
          <polygon fill="url(#revenueGrad)" points={areaPoints} />
          {/* Line */}
          <polyline fill="none" stroke="#10B981" strokeWidth="2" points={linePoints} />
          {/* Dots */}
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#10B981" />
          ))}
        </svg>

        {/* X-axis labels */}
        <div className="flex justify-between mt-1">
          {data.slice(-6).map((d, i) => (
            <span key={i} className="text-[10px] text-muted-foreground">
              {d.month}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}
