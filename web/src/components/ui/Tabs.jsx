import { createContext, forwardRef, useContext, useId, useState } from 'react';
import { cn } from '../../lib/utils';

// WAI-ARIA tabs pattern (https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) with
// automatic activation: arrow keys move focus and select, Home/End jump to the
// first/last enabled tab, and only the selected tab is in the Tab order.

const TabsContext = createContext(null);

function useTabs(component) {
  const context = useContext(TabsContext);
  if (!context) throw new Error(`<${component}> must be rendered inside <Tabs>`);
  return context;
}

const safeId = (value) => String(value).replace(/[^\w-]/g, '_');

/**
 * Tabs root. Controlled with `value` + `onValueChange`, or uncontrolled with
 * `defaultValue`.
 */
const Tabs = forwardRef(({
  value,
  defaultValue,
  onValueChange,
  orientation = 'horizontal',
  id,
  className,
  children,
  ...props
}, ref) => {
  const autoId = useId();
  const baseId = id || `tabs${safeId(autoId)}`;
  const [internal, setInternal] = useState(defaultValue);
  const controlled = value !== undefined;
  const selected = controlled ? value : internal;

  const select = (next) => {
    if (next === selected) return;
    if (!controlled) setInternal(next);
    onValueChange?.(next);
  };

  return (
    <TabsContext.Provider value={{ baseId, selected, select, orientation }}>
      <div ref={ref} className={className} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
});
Tabs.displayName = 'Tabs';

const NEXT_KEYS = { horizontal: 'ArrowRight', vertical: 'ArrowDown' };
const PREV_KEYS = { horizontal: 'ArrowLeft', vertical: 'ArrowUp' };

/** The `role="tablist"` row. Give it an `aria-label` or `aria-labelledby`. */
const TabList = forwardRef(({ className, children, onKeyDown, ...props }, ref) => {
  const { select, orientation } = useTabs('TabList');

  const handleKeyDown = (event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const list = event.currentTarget;
    const tabs = [...list.querySelectorAll('[role="tab"]')]
      .filter((tab) => tab.closest('[role="tablist"]') === list && !tab.disabled);
    if (!tabs.length) return;
    const current = tabs.indexOf(document.activeElement);
    let nextIndex = null;
    if (event.key === NEXT_KEYS[orientation]) nextIndex = current < 0 ? 0 : (current + 1) % tabs.length;
    else if (event.key === PREV_KEYS[orientation]) nextIndex = current < 0 ? tabs.length - 1 : (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    next.focus();
    select(next.getAttribute('data-value'));
  };

  return (
    <div
      ref={ref}
      role="tablist"
      aria-orientation={orientation}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex gap-1',
        orientation === 'horizontal' ? 'border-b border-border overflow-x-auto' : 'flex-col',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
});
TabList.displayName = 'TabList';

/** One tab. `value` is a string and matches a `TabPanel`. */
const Tab = forwardRef(({ value, disabled = false, className, children, onClick, ...props }, ref) => {
  const { baseId, selected, select } = useTabs('Tab');
  const isSelected = selected === value;
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      id={`${baseId}-tab-${safeId(value)}`}
      aria-selected={isSelected}
      aria-controls={isSelected ? `${baseId}-panel-${safeId(value)}` : undefined}
      tabIndex={isSelected ? 0 : -1}
      disabled={disabled}
      data-value={value}
      data-state={isSelected ? 'active' : 'inactive'}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) select(value);
      }}
      className={cn(
        'min-h-11 -mb-px whitespace-nowrap rounded-t-md border-b-2 px-4 py-2 text-sm font-medium',
        'transition-colors motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        isSelected
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
});
Tab.displayName = 'Tab';

/**
 * The panel for one tab. Inactive panels unmount unless `forceMount` is set,
 * in which case they stay in the DOM with `hidden`.
 */
const TabPanel = forwardRef(({ value, forceMount = false, className, children, ...props }, ref) => {
  const { baseId, selected } = useTabs('TabPanel');
  const isSelected = selected === value;
  if (!isSelected && !forceMount) return null;
  return (
    <div
      ref={ref}
      role="tabpanel"
      id={`${baseId}-panel-${safeId(value)}`}
      aria-labelledby={`${baseId}-tab-${safeId(value)}`}
      tabIndex={0}
      hidden={!isSelected}
      className={cn('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md', className)}
      {...props}
    >
      {children}
    </div>
  );
});
TabPanel.displayName = 'TabPanel';

export { Tabs, TabList, Tab, TabPanel };
export default Tabs;
