import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import {
  Loader2,
  ChevronDown,
  Calendar,
  Link2,
  X,
  CheckCircle,
  Clock,
  AlertTriangle,
  Pause,
  ArrowRight,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

// ---- Constants ----

const STATUS_COLORS = {
  PENDING: { bg: '#94a3b8', label: 'To Do' },
  NOT_STARTED: { bg: '#94a3b8', label: 'To Do' },
  IN_PROGRESS: { bg: '#3b82f6', label: 'In Progress' },
  IN_REVIEW: { bg: '#8b5cf6', label: 'In Review' },
  COMPLETED: { bg: '#22c55e', label: 'Completed' },
  DONE: { bg: '#22c55e', label: 'Done' },
  BLOCKED: { bg: '#ef4444', label: 'Blocked' },
};

const PRIORITY_LABELS = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  NORMAL: 'Normal',
  LOW: 'Low',
};

const DAY_WIDTHS = [15, 20, 30, 40, 60];
const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 50;
const LABEL_WIDTH = 280;

// ---- Helpers ----

function daysBetween(a, b) {
  const msPerDay = 86400000;
  return Math.round((new Date(b) - new Date(a)) / msPerDay);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function startOfDay(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---- Component ----

export default function GanttView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const timelineRef = useRef(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [zoomLevel, setZoomLevel] = useState(2); // index into DAY_WIDTHS
  const [editingTask, setEditingTask] = useState(null);
  const [dependencyMode, setDependencyMode] = useState(null); // taskId being linked
  const [tooltip, setTooltip] = useState(null);

  const dayWidth = DAY_WIDTHS[zoomLevel];

  // ---- Data fetching ----

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects(),
  });

  const projects = projectsData?.projects || projectsData || [];

  const { data: ganttData, isLoading } = useQuery({
    queryKey: ['gantt-tasks', selectedProjectId],
    queryFn: () => api.getGanttTasks(selectedProjectId || undefined),
    enabled: true,
  });

  const tasks = ganttData?.tasks || [];

  // ---- Mutations ----

  const updateTaskMut = useMutation({
    mutationFn: ({ id, data }) => api.updateTask(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gantt-tasks'] });
      setEditingTask(null);
    },
  });

  const setDependencyMut = useMutation({
    mutationFn: ({ taskId, dependsOnId }) => api.setTaskDependency(taskId, dependsOnId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gantt-tasks'] });
      setDependencyMode(null);
    },
  });

  // ---- Timeline calculations ----

  const { timelineStart, timelineEnd, totalDays, todayOffset, monthHeaders, weekHeaders } = useMemo(() => {
    const today = startOfDay(new Date());

    // Find date range across all tasks
    let minDate = today;
    let maxDate = addDays(today, 30);

    tasks.forEach(t => {
      const s = t.startDate ? startOfDay(t.startDate) : null;
      const e = t.dueDate ? startOfDay(t.dueDate) : null;
      if (s && s < minDate) minDate = s;
      if (e && e > maxDate) maxDate = e;
      if (s && !e && s > maxDate) maxDate = s;
      if (e && !s && e < minDate) minDate = e;
    });

    // Add padding
    const timelineStart = addDays(minDate, -7);
    const timelineEnd = addDays(maxDate, 14);
    const totalDays = daysBetween(timelineStart, timelineEnd);
    const todayOffset = daysBetween(timelineStart, today);

    // Build month headers
    const months = [];
    let current = new Date(timelineStart);
    while (current <= timelineEnd) {
      const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
      const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
      const startOff = Math.max(0, daysBetween(timelineStart, monthStart));
      const endOff = Math.min(totalDays, daysBetween(timelineStart, monthEnd));
      months.push({
        label: `${MONTH_NAMES[current.getMonth()]} ${current.getFullYear()}`,
        left: startOff * dayWidth,
        width: (endOff - startOff + 1) * dayWidth,
      });
      current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    }

    // Build week headers
    const weeks = [];
    const firstMonday = new Date(timelineStart);
    firstMonday.setDate(firstMonday.getDate() - firstMonday.getDay() + 1);
    let w = new Date(firstMonday);
    while (w <= timelineEnd) {
      const off = daysBetween(timelineStart, w);
      if (off >= 0 && off < totalDays) {
        weeks.push({ left: off * dayWidth, label: formatDate(w) });
      }
      w = addDays(w, 7);
    }

    return { timelineStart, timelineEnd, totalDays, todayOffset, monthHeaders: months, weekHeaders: weeks };
  }, [tasks, dayWidth]);

  // Group tasks by milestone
  const groupedTasks = useMemo(() => {
    const groups = new Map();
    const noMilestone = [];

    tasks.forEach(t => {
      if (t.milestone) {
        const key = t.milestone.id;
        if (!groups.has(key)) {
          groups.set(key, { milestone: t.milestone, tasks: [] });
        }
        groups.get(key).tasks.push(t);
      } else {
        noMilestone.push(t);
      }
    });

    const result = [];
    groups.forEach(g => result.push(g));
    if (noMilestone.length > 0) {
      result.push({ milestone: null, tasks: noMilestone });
    }
    return result;
  }, [tasks]);

  // Flat list for rendering rows with group headers
  const rows = useMemo(() => {
    const list = [];
    groupedTasks.forEach(group => {
      list.push({ type: 'group', milestone: group.milestone, count: group.tasks.length });
      group.tasks.forEach(t => list.push({ type: 'task', task: t }));
    });
    return list;
  }, [groupedTasks]);

  // Task positions lookup for dependency arrows
  const taskPositions = useMemo(() => {
    const map = {};
    let y = 0;
    rows.forEach(row => {
      if (row.type === 'task') {
        const t = row.task;
        const s = t.startDate ? startOfDay(t.startDate) : (t.dueDate ? addDays(startOfDay(t.dueDate), -3) : null);
        const e = t.dueDate ? startOfDay(t.dueDate) : (t.startDate ? addDays(startOfDay(t.startDate), 3) : null);
        if (s && e) {
          const left = daysBetween(timelineStart, s) * dayWidth;
          const width = Math.max(dayWidth, daysBetween(s, e) * dayWidth);
          map[t.id] = { left, width, top: y * ROW_HEIGHT + ROW_HEIGHT / 2 };
        }
      }
      y++;
    });
    return map;
  }, [rows, timelineStart, dayWidth]);

  // Scroll to today on mount
  useEffect(() => {
    if (timelineRef.current && todayOffset > 0) {
      const scrollTo = todayOffset * dayWidth - 200;
      timelineRef.current.scrollLeft = Math.max(0, scrollTo);
    }
  }, [todayOffset, dayWidth, tasks.length]);

  // ---- Handlers ----

  const handleBarClick = useCallback((task) => {
    if (dependencyMode) {
      if (dependencyMode !== task.id) {
        setDependencyMut.mutate({ taskId: dependencyMode, dependsOnId: task.id });
      } else {
        setDependencyMode(null);
      }
    } else {
      setEditingTask(task);
    }
  }, [dependencyMode, setDependencyMut]);

  const handleRemoveDependency = useCallback((taskId) => {
    setDependencyMut.mutate({ taskId, dependsOnId: null });
  }, [setDependencyMut]);

  // ---- Render ----

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const timelineWidth = totalDays * dayWidth;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Gantt Timeline</h1>
          <p className="text-muted-foreground text-sm">Visualize project timelines and task dependencies</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-card border border-border rounded-lg px-2 py-1">
            <button
              onClick={() => setZoomLevel(Math.max(0, zoomLevel - 1))}
              disabled={zoomLevel === 0}
              className="p-1 hover:bg-muted rounded disabled:opacity-30"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="text-xs text-muted-foreground px-1">{dayWidth}px/day</span>
            <button
              onClick={() => setZoomLevel(Math.min(DAY_WIDTHS.length - 1, zoomLevel + 1))}
              disabled={zoomLevel === DAY_WIDTHS.length - 1}
              className="p-1 hover:bg-muted rounded disabled:opacity-30"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>

          {/* Dependency mode toggle */}
          {dependencyMode ? (
            <button
              onClick={() => setDependencyMode(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm font-medium"
            >
              <X className="h-3.5 w-3.5" />
              Cancel Link
            </button>
          ) : null}

          {/* Project selector */}
          <div className="relative">
            <select
              value={selectedProjectId}
              onChange={e => setSelectedProjectId(e.target.value)}
              className="appearance-none bg-card border border-border rounded-lg px-3 py-1.5 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">All Projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs">
        {Object.entries(STATUS_COLORS).map(([key, { bg, label }]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: bg }} />
            <span className="text-muted-foreground">{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 ml-4">
          <div className="w-6 border-t-2 border-dashed border-red-400" />
          <span className="text-muted-foreground">Today</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ArrowRight className="h-3 w-3 text-amber-500" />
          <span className="text-muted-foreground">Dependency</span>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-foreground mb-1">No tasks with dates</h3>
          <p className="text-muted-foreground text-sm">
            Add start dates and due dates to your tasks to see them on the timeline.
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex" style={{ minHeight: (rows.length * ROW_HEIGHT) + HEADER_HEIGHT + 20 }}>
            {/* Left: task labels */}
            <div className="flex-shrink-0 border-r border-border bg-muted/30" style={{ width: LABEL_WIDTH }}>
              {/* Header spacer */}
              <div className="border-b border-border px-3 flex items-center text-xs font-semibold text-muted-foreground uppercase tracking-wider" style={{ height: HEADER_HEIGHT }}>
                Task
              </div>
              {/* Rows */}
              {rows.map((row, i) => {
                if (row.type === 'group') {
                  return (
                    <div
                      key={`group-${i}`}
                      className="flex items-center px-3 bg-muted/50 border-b border-border"
                      style={{ height: ROW_HEIGHT }}
                    >
                      <div
                        className="w-2.5 h-2.5 rounded-full mr-2 flex-shrink-0"
                        style={{ backgroundColor: row.milestone?.color || '#6b7280' }}
                      />
                      <span className="text-xs font-semibold text-foreground truncate">
                        {row.milestone?.name || 'No Milestone'}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1.5">({row.count})</span>
                    </div>
                  );
                }
                const t = row.task;
                const sc = STATUS_COLORS[t.effectiveStatus] || STATUS_COLORS[t.status] || STATUS_COLORS.PENDING;
                return (
                  <div
                    key={t.id}
                    className="flex items-center px-3 border-b border-border/50 hover:bg-muted/40 cursor-pointer group"
                    style={{ height: ROW_HEIGHT }}
                    onClick={() => handleBarClick(t)}
                  >
                    <div className="w-2 h-2 rounded-full mr-2 flex-shrink-0" style={{ backgroundColor: sc.bg }} />
                    <span className="text-sm text-foreground truncate flex-1">{t.title}</span>
                    {t.assignee && (
                      <span className="text-[10px] bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 ml-1 flex-shrink-0 hidden group-hover:inline">
                        {t.assignee.name?.split(' ')[0]}
                      </span>
                    )}
                    {/* Dependency link button */}
                    <button
                      onClick={e => { e.stopPropagation(); setDependencyMode(t.id); }}
                      className="p-0.5 hover:bg-muted rounded opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                      title="Set dependency"
                    >
                      <Link2 className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Right: timeline area */}
            <div className="flex-1 overflow-x-auto" ref={timelineRef}>
              <div style={{ width: timelineWidth, position: 'relative' }}>
                {/* Month headers */}
                <div className="border-b border-border relative" style={{ height: HEADER_HEIGHT / 2 }}>
                  {monthHeaders.map((m, i) => (
                    <div
                      key={i}
                      className="absolute top-0 text-[10px] font-semibold text-muted-foreground px-2 border-l border-border/50 flex items-center"
                      style={{ left: m.left, width: m.width, height: HEADER_HEIGHT / 2 }}
                    >
                      {m.label}
                    </div>
                  ))}
                </div>
                {/* Week headers */}
                <div className="border-b border-border relative" style={{ height: HEADER_HEIGHT / 2 }}>
                  {weekHeaders.map((w, i) => (
                    <div
                      key={i}
                      className="absolute top-0 text-[10px] text-muted-foreground px-1 border-l border-border/30 flex items-center"
                      style={{ left: w.left, height: HEADER_HEIGHT / 2 }}
                    >
                      {w.label}
                    </div>
                  ))}
                </div>

                {/* Grid rows + bars */}
                <div style={{ position: 'relative' }}>
                  {/* Background grid lines (weekends) */}
                  {Array.from({ length: totalDays }).map((_, d) => {
                    const date = addDays(timelineStart, d);
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                    if (!isWeekend) return null;
                    return (
                      <div
                        key={d}
                        className="absolute top-0 bottom-0 bg-muted/30"
                        style={{ left: d * dayWidth, width: dayWidth, height: rows.length * ROW_HEIGHT }}
                      />
                    );
                  })}

                  {/* Today line */}
                  {todayOffset >= 0 && todayOffset <= totalDays && (
                    <div
                      className="absolute top-0 z-20 border-l-2 border-dashed border-red-400"
                      style={{
                        left: todayOffset * dayWidth,
                        height: rows.length * ROW_HEIGHT,
                      }}
                    >
                      <div className="absolute -top-5 -left-3 text-[9px] font-bold text-red-500 bg-red-50 rounded px-1">
                        Today
                      </div>
                    </div>
                  )}

                  {/* Row separators */}
                  {rows.map((row, i) => (
                    <div
                      key={`sep-${i}`}
                      className={`absolute left-0 right-0 border-b ${row.type === 'group' ? 'border-border bg-muted/20' : 'border-border/30'}`}
                      style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT, width: timelineWidth }}
                    />
                  ))}

                  {/* Task bars */}
                  {rows.map((row, i) => {
                    if (row.type !== 'task') return null;
                    const t = row.task;
                    const s = t.startDate ? startOfDay(t.startDate) : (t.dueDate ? addDays(startOfDay(t.dueDate), -3) : null);
                    const e = t.dueDate ? startOfDay(t.dueDate) : (t.startDate ? addDays(startOfDay(t.startDate), 3) : null);

                    if (!s && !e) {
                      // No dates — show a diamond marker at today
                      return (
                        <div
                          key={t.id}
                          className="absolute z-10 cursor-pointer"
                          style={{
                            left: todayOffset * dayWidth - 5,
                            top: i * ROW_HEIGHT + ROW_HEIGHT / 2 - 5,
                            width: 10,
                            height: 10,
                            backgroundColor: (STATUS_COLORS[t.effectiveStatus] || STATUS_COLORS.PENDING).bg,
                            transform: 'rotate(45deg)',
                            borderRadius: 2,
                          }}
                          onClick={() => handleBarClick(t)}
                          title={`${t.title} (no dates set)`}
                        />
                      );
                    }

                    const left = daysBetween(timelineStart, s) * dayWidth;
                    const barDays = Math.max(1, daysBetween(s, e));
                    const width = barDays * dayWidth;
                    const sc = STATUS_COLORS[t.effectiveStatus] || STATUS_COLORS[t.status] || STATUS_COLORS.PENDING;

                    return (
                      <div
                        key={t.id}
                        className="absolute z-10 rounded-md cursor-pointer hover:brightness-110 transition-all group/bar"
                        style={{
                          left,
                          top: i * ROW_HEIGHT + 8,
                          width: Math.max(dayWidth * 0.5, width),
                          height: ROW_HEIGHT - 16,
                          backgroundColor: sc.bg,
                          opacity: t.effectiveStatus === 'COMPLETED' || t.effectiveStatus === 'DONE' ? 0.6 : 0.85,
                        }}
                        onClick={() => handleBarClick(t)}
                        onMouseEnter={evt => {
                          const rect = evt.currentTarget.getBoundingClientRect();
                          setTooltip({
                            x: rect.left + rect.width / 2,
                            y: rect.top - 8,
                            task: t,
                          });
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        {/* Bar label (if wide enough) */}
                        {width > 80 && (
                          <div className="absolute inset-0 flex items-center px-2 overflow-hidden">
                            <span className="text-[11px] font-medium text-white truncate drop-shadow-sm">
                              {t.title}
                            </span>
                          </div>
                        )}
                        {/* Dependency indicator */}
                        {t.dependsOn && (
                          <div className="absolute -left-1 -top-1 w-3 h-3 bg-amber-400 rounded-full border border-white flex items-center justify-center">
                            <Link2 className="h-1.5 w-1.5 text-white" />
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Dependency arrows */}
                  <svg
                    className="absolute top-0 left-0 pointer-events-none z-5"
                    style={{ width: timelineWidth, height: rows.length * ROW_HEIGHT }}
                  >
                    {rows.map((row) => {
                      if (row.type !== 'task' || !row.task.dependsOnId) return null;
                      const t = row.task;
                      const from = taskPositions[t.dependsOnId];
                      const to = taskPositions[t.id];
                      if (!from || !to) return null;

                      const x1 = from.left + from.width;
                      const y1 = from.top;
                      const x2 = to.left;
                      const y2 = to.top;

                      // Simple right-angle connector
                      const midX = x1 + (x2 - x1) / 2;

                      return (
                        <g key={`dep-${t.id}`}>
                          <path
                            d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                            fill="none"
                            stroke="#f59e0b"
                            strokeWidth="2"
                            strokeDasharray="4 2"
                            opacity="0.7"
                          />
                          {/* Arrow head */}
                          <polygon
                            points={`${x2},${y2} ${x2 - 6},${y2 - 4} ${x2 - 6},${y2 + 4}`}
                            fill="#f59e0b"
                            opacity="0.7"
                          />
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="bg-popover border border-border rounded-lg shadow-lg p-3 text-sm max-w-xs">
            <div className="font-semibold text-foreground mb-1">{tooltip.task.title}</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: (STATUS_COLORS[tooltip.task.effectiveStatus] || STATUS_COLORS.PENDING).bg }}
              />
              {(STATUS_COLORS[tooltip.task.effectiveStatus] || STATUS_COLORS.PENDING).label}
              {tooltip.task.priority && (
                <>
                  <span className="text-border">|</span>
                  {PRIORITY_LABELS[tooltip.task.priority] || tooltip.task.priority}
                </>
              )}
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              {tooltip.task.startDate && (
                <div>Start: {formatDate(tooltip.task.startDate)}</div>
              )}
              {tooltip.task.dueDate && (
                <div>Due: {formatDate(tooltip.task.dueDate)}</div>
              )}
              {tooltip.task.assignee && (
                <div>Assignee: {tooltip.task.assignee.name}</div>
              )}
              {tooltip.task.dependsOn && (
                <div className="text-amber-600">
                  Depends on: {tooltip.task.dependsOn.title}
                  {tooltip.task.dependsOn.status !== 'COMPLETED' && tooltip.task.dependsOn.status !== 'DONE' && (
                    <span className="text-red-500 ml-1">(not done)</span>
                  )}
                </div>
              )}
              {tooltip.task.project && (
                <div>Project: {tooltip.task.project.name}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dependency mode banner */}
      {dependencyMode && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-amber-100 border border-amber-300 text-amber-800 rounded-xl px-5 py-3 shadow-lg flex items-center gap-3 text-sm font-medium">
          <Link2 className="h-4 w-4" />
          Click a task bar to set it as the dependency. This task will depend on the one you click.
          <button
            onClick={() => setDependencyMode(null)}
            className="ml-2 px-2 py-0.5 bg-amber-200 hover:bg-amber-300 rounded text-amber-900 text-xs"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Edit dialog */}
      {editingTask && (
        <TaskEditDialog
          task={editingTask}
          tasks={tasks}
          onClose={() => setEditingTask(null)}
          onSave={(id, data) => updateTaskMut.mutate({ id, data })}
          onRemoveDependency={handleRemoveDependency}
          onNavigate={navigate}
          saving={updateTaskMut.isPending}
        />
      )}
    </div>
  );
}

// ---- Task Edit Dialog ----

function TaskEditDialog({ task, tasks, onClose, onSave, onRemoveDependency, onNavigate, saving }) {
  const [startDate, setStartDate] = useState(task.startDate ? new Date(task.startDate).toISOString().split('T')[0] : '');
  const [dueDate, setDueDate] = useState(task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : '');
  const [status, setStatus] = useState(task.status);

  const handleSave = () => {
    onSave(task.id, {
      startDate: startDate || null,
      dueDate: dueDate || null,
      status,
    });
  };

  const sc = STATUS_COLORS[task.effectiveStatus] || STATUS_COLORS.PENDING;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold text-foreground text-lg truncate">{task.title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Status */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: sc.bg }} />
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="bg-muted border border-border rounded px-2 py-1 text-sm flex-1"
              >
                <option value="PENDING">To Do</option>
                <option value="NOT_STARTED">Not Started</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="IN_REVIEW">In Review</option>
                <option value="COMPLETED">Completed</option>
                <option value="DONE">Done</option>
                <option value="BLOCKED">Blocked</option>
              </select>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="bg-muted border border-border rounded px-2 py-1 text-sm w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="bg-muted border border-border rounded px-2 py-1 text-sm w-full"
              />
            </div>
          </div>

          {/* Info */}
          <div className="text-xs text-muted-foreground space-y-1">
            {task.assignee && <div>Assignee: <span className="text-foreground">{task.assignee.name}</span></div>}
            {task.project && <div>Project: <span className="text-foreground">{task.project.name}</span></div>}
            {task.milestone && <div>Milestone: <span className="text-foreground">{task.milestone.name}</span></div>}
            {task.priority && <div>Priority: <span className="text-foreground">{PRIORITY_LABELS[task.priority] || task.priority}</span></div>}
          </div>

          {/* Dependency info */}
          {task.dependsOn && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs">
                  <span className="text-amber-700 font-medium">Depends on:</span>
                  <span className="ml-1 text-foreground">{task.dependsOn.title}</span>
                  <span className="ml-1.5">
                    {task.dependsOn.status === 'COMPLETED' || task.dependsOn.status === 'DONE' ? (
                      <CheckCircle className="inline h-3 w-3 text-green-500" />
                    ) : (
                      <Clock className="inline h-3 w-3 text-amber-500" />
                    )}
                  </span>
                </div>
                <button
                  onClick={() => onRemoveDependency(task.id)}
                  className="text-red-500 hover:text-red-700 p-0.5"
                  title="Remove dependency"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Blocked tasks */}
          {task.blockedTasks?.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="text-xs text-red-700 font-medium mb-1">Blocking {task.blockedTasks.length} task(s):</div>
              {task.blockedTasks.map(bt => (
                <div key={bt.id} className="text-xs text-foreground ml-2">- {bt.title}</div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between p-4 border-t border-border">
          <button
            onClick={() => { onClose(); onNavigate(`/task/${task.id}`); }}
            className="text-xs text-primary hover:underline"
          >
            Open full page
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
