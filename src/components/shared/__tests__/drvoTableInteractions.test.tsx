// @vitest-environment happy-dom

import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DataTable, { type DataTableColumn } from '../DataTable';
import Toolbar from '../Toolbar';

type Row = { id: number; amount: number };
const rows: Row[] = [{ id: 1, amount: 20 }, { id: 2, amount: 100 }];
const columns: DataTableColumn<Row>[] = [
  { key: 'id', header: 'الفاتورة', cell: (row) => row.id },
  { key: 'amount', header: 'المبلغ', numeric: true, cell: (row) => row.amount, sortValue: (row) => row.amount },
];
const rowKey = (row: Row) => row.id;
const amounts = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[1].textContent);

afterEach(cleanup);

describe('DRVO shared DataTable interactions', () => {
  it('sorts numeric amounts descending, ascending and restores original order', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={rowKey} />);
    const sort = screen.getByRole('button', { name: 'المبلغ' });
    expect(amounts()).toEqual(['20', '100']);
    fireEvent.click(sort);
    expect(amounts()).toEqual(['100', '20']);
    expect(screen.getByRole('columnheader', { name: 'المبلغ' }).getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(sort);
    expect(amounts()).toEqual(['20', '100']);
    expect(screen.getByRole('columnheader', { name: 'المبلغ' }).getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(sort);
    expect(screen.getByRole('columnheader', { name: 'المبلغ' }).hasAttribute('aria-sort')).toBe(false);
  });

  it('supports Enter and Space on an interactive row without activating it from a nested control', () => {
    const onRowClick = vi.fn();
    const nested = vi.fn();
    render(<DataTable rows={rows} rowKey={rowKey} onRowClick={onRowClick} columns={[
      ...columns,
      { key: 'action', header: 'إجراءات', cell: (row) => <button onClick={(event) => { event.stopPropagation(); nested(row.id); }}>تعديل {row.id}</button> },
    ]} />);
    const row = screen.getAllByRole('row')[1];
    expect(row.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onRowClick.mock.calls).toEqual([[rows[0]], [rows[0]]]);
    fireEvent.keyDown(screen.getByRole('button', { name: 'تعديل 1' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'تعديل 1' }));
    expect(nested).toHaveBeenCalledWith(1);
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });

  it('shows retry instead of stale rows when loading fails', () => {
    const retry = vi.fn();
    render(<DataTable rows={rows} columns={columns} rowKey={rowKey} error="تعذر الاتصال" onRetry={retry} />);
    expect(screen.getByRole('alert').textContent).toContain('تعذر الاتصال');
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps loading and filtered-empty states distinct', () => {
    const { rerender } = render(<DataTable rows={[]} columns={columns} rowKey={rowKey} loading loadingRows={3} />);
    expect(screen.getByRole('table').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('row')).toHaveLength(4);
    rerender(<DataTable rows={[]} columns={columns} rowKey={rowKey} empty={{ title: 'لا توجد نتائج', kind: 'no-results' }} />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('لا توجد نتائج')).toBeDefined();
  });
});

function SearchFixture() {
  const [query, setQuery] = useState('');
  return <Toolbar search={{ value: query, onChange: setQuery, placeholder: 'بحث' }}
    chips={query ? [{ key: 'q', label: query, onRemove: () => setQuery('') }] : []} />;
}

describe('DRVO shared Toolbar interactions', () => {
  it('updates the controlled search and removes its active filter', () => {
    render(<SearchFixture />);
    const search = screen.getByRole('searchbox', { name: 'بحث' }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: '123' } });
    expect(search.value).toBe('123');
    expect(screen.getByText('123')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'إزالة الفلتر' }));
    expect(search.value).toBe('');
    expect(screen.queryByText('123')).toBeNull();
  });
});
