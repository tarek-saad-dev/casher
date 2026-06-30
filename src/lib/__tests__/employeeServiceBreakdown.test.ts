import { describe, it, expect } from 'vitest';
import { classifyService } from '@/lib/services/classifyService';
import {
  aggregateEmployeeServiceBreakdown,
  calculateServiceLineTotal,
  classifyServiceLines,
  resolveBarberRevenue,
  sumEmployeeServiceBreakdown,
  type EmployeeServiceBreakdown,
} from '@/lib/services/employeeServiceBreakdown';

describe('classifyService', () => {
  it('classifies hair-only service by ProID', () => {
    expect(classifyService({ proId: 1, serviceName: 'Hair Cut' })).toBe('hair');
    expect(classifyService({ proId: 4, serviceName: 'Fade Cut' })).toBe('hair');
    expect(classifyService({ proId: 5, serviceName: 'Advanced Cut' })).toBe('hair');
  });

  it('classifies hair-and-beard service by ProID', () => {
    expect(classifyService({ proId: 3, serviceName: 'Haircut & Beard' })).toBe('hair_beard');
  });

  it('classifies beard-only service by ProID', () => {
    expect(classifyService({ proId: 2, serviceName: 'Beard Styling & Fade' })).toBe('beard');
  });

  it('classifies unrelated services as other', () => {
    expect(classifyService({ proId: 99, serviceName: 'Basic Skin Care' })).toBe('other');
  });

  it('falls back to normalized service names when ProID is unknown', () => {
    expect(classifyService({ proId: 999, serviceName: 'Hair Cut' })).toBe('hair');
    expect(classifyService({ proId: 999, serviceName: 'Haircut & Beard' })).toBe('hair_beard');
    expect(classifyService({ proId: 999, serviceNameAr: 'حلاقة شعر' })).toBe('hair');
    expect(classifyService({ proId: 999, serviceNameAr: 'شعر ودقن' })).toBe('hair_beard');
  });
});

describe('calculateServiceLineTotal', () => {
  it('uses SValue minus discount when SValue is positive', () => {
    expect(
      calculateServiceLineTotal({
        qty: 1,
        unitPrice: 100,
        discountValue: 20,
        sValue: 200,
      })
    ).toBe(180);
  });

  it('uses qty * price minus discount when SValue is zero', () => {
    expect(
      calculateServiceLineTotal({
        qty: 2,
        unitPrice: 50,
        discountValue: 10,
        sValue: 0,
      })
    ).toBe(90);
  });

  it('treats null values as zero', () => {
    expect(
      calculateServiceLineTotal({
        qty: null,
        unitPrice: null,
        discountValue: null,
        sValue: null,
      })
    ).toBe(0);
  });
});

describe('aggregateEmployeeServiceBreakdown', () => {
  it('aggregates discounted service revenue into the correct category', () => {
    const rows = aggregateEmployeeServiceBreakdown([
      {
        empId: 1,
        empName: 'بشار',
        proId: 1,
        serviceName: 'Hair Cut',
        qty: 1,
        unitPrice: 100,
        discountValue: 20,
        sValue: 100,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].hairRevenue).toBe(80);
    expect(rows[0].barberRevenue).toBe(80);
    expect(rows[0].otherRevenue).toBe(0);
    expect(rows[0].totalRevenue).toBe(80);
    expect(rows[0].hairCount).toBe(1);
  });

  it('handles multiple employees in one invoice without double-counting', () => {
    const rows = aggregateEmployeeServiceBreakdown([
      {
        empId: 1,
        empName: 'أحمد',
        proId: 1,
        serviceName: 'Hair Cut',
        lineTotal: 100,
      },
      {
        empId: 2,
        empName: 'بشار',
        proId: 3,
        serviceName: 'Haircut & Beard',
        lineTotal: 150,
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.employeeId === 1)?.totalRevenue).toBe(100);
    expect(rows.find(r => r.employeeId === 2)?.totalRevenue).toBe(150);
    expect(sumEmployeeServiceBreakdown(rows).totalRevenue).toBe(250);
  });

  it('shows zero for categories with no services', () => {
    const rows = aggregateEmployeeServiceBreakdown([
      {
        empId: 5,
        empName: 'كريم',
        proId: 1,
        serviceName: 'Hair Cut',
        lineTotal: 3000,
      },
    ]);

    expect(rows[0].hairRevenue).toBe(3000);
    expect(rows[0].barberRevenue).toBe(3000);
    expect(rows[0].otherRevenue).toBe(0);
    expect(rows[0].totalRevenue).toBe(3000);
  });

  it('keeps barber and other totals equal to totalRevenue', () => {
    const lines = [
      { empId: 1, empName: 'بشار', proId: 1, serviceName: 'Hair Cut', lineTotal: 3000 },
      { empId: 1, empName: 'بشار', proId: 3, serviceName: 'Haircut & Beard', lineTotal: 4500 },
      { empId: 1, empName: 'بشار', proId: 2, serviceName: 'Beard Styling & Fade', lineTotal: 1200 },
    ];

    const rows = aggregateEmployeeServiceBreakdown(lines);
    const row = rows[0];

    expect(row.barberRevenue).toBe(8700);
    expect(row.otherRevenue).toBe(0);
    expect(row.totalRevenue).toBe(8700);
    expect(row.totalRevenue).toBe(row.barberRevenue + row.otherRevenue);
  });

  it('classifies hair, hair_beard, and other service lines', () => {
    const classified = classifyServiceLines([
      { empId: 1, empName: 'Test', proId: 1, serviceName: 'Hair Cut', lineTotal: 50 },
      { empId: 1, empName: 'Test', proId: 3, serviceName: 'Haircut & Beard', lineTotal: 80 },
      { empId: 1, empName: 'Test', proId: 9, serviceName: 'Basic Skin Care', lineTotal: 60 },
    ]);

    expect(classified.map(l => l.serviceCategory)).toEqual(['hair', 'hair_beard', 'other']);
  });

  it('resolves barberRevenue from legacy row without barberRevenue field', () => {
    const amount = resolveBarberRevenue({
      hairRevenue: 3000,
      hairBeardRevenue: 4500,
      beardRevenue: 1200,
    } as EmployeeServiceBreakdown);

    expect(amount).toBe(8700);
  });
});
