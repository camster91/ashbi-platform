import { TrendingUp, DollarSign } from 'lucide-react';
import { Card } from '../ui';

export default function RevenueSparklineWidget({ data = [] }) {
  if (!data?.length) return null;

  const byCurrency = data.reduce((series, point) => {
    const currency = point.currency || 'UNASSIGNED';
    (series[currency] ||= []).push(point);
    return series;
  }, {});
  const totals = Object.fromEntries(Object.entries(byCurrency).map(([currency, points]) => [
    currency,
    points.reduce((sum, point) => sum + point.total, 0),
  ]));

  return (
    <Card>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-500" />
          <h2 className="font-semibold text-foreground">Revenue Trend</h2>
        </div>
        <span className="text-right text-xs font-bold text-emerald-600">
          {Object.entries(totals).map(([currency, total]) => (
            <span key={currency} className="block">{total.toLocaleString('en-CA', { maximumFractionDigits: 0 })} {currency}</span>
          ))}
        </span>
      </div>
      <div className="space-y-4 p-4">
        {Object.entries(byCurrency).map(([currency, points]) => (
          <RevenueSeries key={currency} currency={currency} data={points} />
        ))}
      </div>
    </Card>
  );
}

function RevenueSeries({ currency, data }) {
  const max = Math.max(...data.map(point => point.total), 1);
  const width = Math.max(data.length * 20, 20);
  const height = 60;
  const points = data.map((point, index) => ({
    x: index * 20,
    y: height - (point.total / max) * 50,
  }));
  const areaPoints = [[0, height], ...points.map(point => [point.x, point.y]), [width, height]]
    .map(point => point.join(','))
    .join(' ');
  const linePoints = points.map(point => `${point.x},${point.y}`).join(' ');
  const gradientId = `revenue-${currency.toLowerCase()}`;

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{currency}</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-full overflow-visible" aria-label={`${currency} paid invoice revenue trend`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10B981" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon fill={`url(#${gradientId})`} points={areaPoints} />
        <polyline fill="none" stroke="#10B981" strokeWidth="2" points={linePoints} />
        {points.map((point, index) => (
          <circle key={index} cx={point.x} cy={point.y} r="2.5" fill="#10B981" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between">
        {data.slice(-6).map((point, index) => (
          <span key={`${point.year}-${point.month}-${index}`} className="text-[10px] text-muted-foreground">{point.month}</span>
        ))}
      </div>
    </div>
  );
}
