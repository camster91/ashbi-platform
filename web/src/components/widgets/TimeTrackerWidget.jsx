import { Clock, Timer, TrendingUp } from 'lucide-react';
import { Card } from '../ui';
import { cn } from '../../lib/utils';

export default function TimeTrackerWidget({ data }) {
  if (!data) return null;
  const { today, todayBillable, week, weekBillable, capacity, weekGoalHours } = data;
  const todayHours = (today / 60).toFixed(1);
  const todayBillableHours = (todayBillable / 60).toFixed(1);
  const weekHours = (week / 60).toFixed(1);
  const weekBillableHours = (weekBillable / 60).toFixed(1);
  const weekProgress = Math.min((week / (weekGoalHours * 60)) * 100, 100);
  const todayProgress = Math.min((today / (8 * 60)) * 100, 100);

  return (
    <Card>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Timer className="w-4 h-4 text-blue-500" />
          <h2 className="font-semibold text-foreground">Time Tracking</h2>
        </div>
        <span className="text-xs text-muted-foreground">{capacity}% capacity</span>
      </div>
      <div className="p-4 space-y-4">
        {/* Today */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-foreground">Today</span>
            <span className="text-sm font-bold text-foreground">{todayHours}h <span className="text-xs font-normal text-emerald-600">({todayBillableHours}h billable)</span></span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-500', todayProgress >= 100 ? 'bg-emerald-500' : 'bg-blue-500')}
              style={{ width: `${todayProgress}%` }}
            />
          </div>
        </div>
        {/* This week */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-foreground">This Week</span>
            <span className="text-sm font-bold text-foreground">{weekHours}h <span className="text-xs font-normal text-emerald-600">({weekBillableHours}h billable)</span></span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-500', weekProgress >= 100 ? 'bg-emerald-500' : 'bg-blue-500')}
              style={{ width: `${weekProgress}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">Goal: {weekGoalHours}h/week</p>
        </div>
      </div>
    </Card>
  );
}
