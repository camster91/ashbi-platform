/**
 * Tabs primitive: WAI-ARIA tabs pattern with automatic activation.
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Tab, TabList, TabPanel, Tabs } from '../components/ui/Tabs';

function Example({ onValueChange, disabledSecond = false }) {
  return (
    <Tabs defaultValue="one" onValueChange={onValueChange}>
      <TabList aria-label="Example views">
        <Tab value="one">One</Tab>
        <Tab value="two" disabled={disabledSecond}>Two</Tab>
        <Tab value="three">Three</Tab>
      </TabList>
      <TabPanel value="one">Panel one</TabPanel>
      <TabPanel value="two">Panel two</TabPanel>
      <TabPanel value="three">Panel three</TabPanel>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('renders a named tablist with one selected, focusable tab and a labelled panel', () => {
    render(<Example />);
    expect(screen.getByRole('tablist', { name: 'Example views' })).toHaveAttribute('aria-orientation', 'horizontal');
    const one = screen.getByRole('tab', { name: 'One' });
    const two = screen.getByRole('tab', { name: 'Two' });
    expect(one).toHaveAttribute('aria-selected', 'true');
    expect(one).toHaveAttribute('tabindex', '0');
    expect(two).toHaveAttribute('aria-selected', 'false');
    expect(two).toHaveAttribute('tabindex', '-1');
    const panel = screen.getByRole('tabpanel', { name: 'One' });
    expect(panel).toHaveTextContent('Panel one');
    expect(one).toHaveAttribute('aria-controls', panel.id);
    expect(screen.queryByText('Panel two')).toBeNull();
  });

  it('moves focus and selection with arrow keys, wrapping, and Home/End', () => {
    const onValueChange = vi.fn();
    render(<Example onValueChange={onValueChange} />);
    const one = screen.getByRole('tab', { name: 'One' });
    one.focus();
    fireEvent.keyDown(one, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel two');
    expect(onValueChange).toHaveBeenLastCalledWith('two');

    fireEvent.keyDown(document.activeElement, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Three' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'One' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Three' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement, { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'true');
  });

  it('skips disabled tabs', () => {
    render(<Example disabledSecond />);
    const one = screen.getByRole('tab', { name: 'One' });
    one.focus();
    fireEvent.keyDown(one, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Three' })).toHaveFocus();
  });

  it('selects on click and works controlled', () => {
    function Controlled() {
      const [value, setValue] = useState('b');
      return (
        <Tabs value={value} onValueChange={setValue}>
          <TabList aria-label="Controlled">
            <Tab value="a">A</Tab>
            <Tab value="b">B</Tab>
          </TabList>
          <TabPanel value="a">Alpha</TabPanel>
          <TabPanel value="b" forceMount>Beta</TabPanel>
        </Tabs>
      );
    }
    render(<Controlled />);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Beta');
    fireEvent.click(screen.getByRole('tab', { name: 'A' }));
    expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Alpha');
    // forceMount keeps the inactive panel in the DOM, hidden.
    expect(screen.getByText('Beta').closest('[role="tabpanel"]')).toHaveAttribute('hidden');
  });

  it('uses tokens, a 44px target and a visible focus ring', () => {
    render(<Example />);
    const tab = screen.getByRole('tab', { name: 'One' });
    expect(tab.className).toContain('min-h-11');
    expect(tab.className).toContain('focus-visible:ring-ring');
    expect(tab.className).toContain('border-primary');
  });

  it('throws a clear error outside <Tabs>', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Tab value="x">X</Tab>)).toThrow(/inside <Tabs>/);
    spy.mockRestore();
  });
  it('keeps numeric values working after arrow-key navigation', () => {
    function Numeric() {
      const [value, setValue] = useState(1);
      return (
        <Tabs value={value} onValueChange={setValue}>
          <TabList aria-label="Years">
            <Tab value={1}>First</Tab>
            <Tab value={2}>Second</Tab>
          </TabList>
          <TabPanel value={1}>Year one</TabPanel>
          <TabPanel value={2}>Year two</TabPanel>
        </Tabs>
      );
    }
    render(<Numeric />);
    const first = screen.getByRole('tab', { name: 'First' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const second = screen.getByRole('tab', { name: 'Second' });
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(second).toHaveAttribute('tabindex', '0');
    expect(first).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Year two');
    fireEvent.keyDown(second, { key: 'ArrowLeft' });
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Year one');
  });

  it('defaults an uncontrolled Tabs without defaultValue to the first enabled tab', () => {
    const onValueChange = vi.fn();
    render(
      <Tabs onValueChange={onValueChange}>
        <TabList aria-label="Views">
          <Tab value="a" disabled>A</Tab>
          <Tab value="b">B</Tab>
          <Tab value="c">C</Tab>
        </TabList>
        <TabPanel value="b">Panel b</TabPanel>
        <TabPanel value="c">Panel c</TabPanel>
      </Tabs>
    );
    const b = screen.getByRole('tab', { name: 'B' });
    expect(b).toHaveAttribute('aria-selected', 'true');
    expect(b).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel b');
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
