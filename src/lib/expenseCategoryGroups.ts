import {
  Briefcase,
  Calendar,
  Package,
  ShoppingCart,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface ExpenseCategoryGroupDef {
  id: string;
  name: string;
  icon: LucideIcon;
  keywords: string[];
}

export const EXPENSE_CATEGORY_GROUPS: ExpenseCategoryGroupDef[] = [
  {
    id: 'advances',
    name: 'سلف وخصومات شخصية',
    icon: Users,
    keywords: ['سلفة', 'سلف', 'خصم'],
  },
  {
    id: 'payroll',
    name: 'رواتب ومكافآت',
    icon: Wallet,
    keywords: ['مرتبات', 'راتب', 'رواتب', 'تارجت', 'مكافأة', 'حوافز', 'يوميات'],
  },
  {
    id: 'operational',
    name: 'مصروفات تشغيلية',
    icon: Briefcase,
    keywords: [
      'بوفيه',
      'تنظيف',
      'توصيل',
      'كهرباء',
      'مياه',
      'تكاليف',
      'نسبة',
      'مصاريف',
      'غاز',
      'انترنت',
      'تليفون',
      'صيانة',
    ],
  },
  {
    id: 'inventory',
    name: 'دعاية ومشتريات',
    icon: Package,
    keywords: ['بضاعة', 'دعاية', 'إعلان', 'تسويق', 'مشتريات'],
  },
  {
    id: 'recurring',
    name: 'التزامات دورية',
    icon: Calendar,
    keywords: ['اشتراكات', 'جمعيات', 'أقساط', 'قسط', 'إيجار', 'ايجار', 'ضريبة', 'تأمين'],
  },
  {
    id: 'settlements',
    name: 'تسويات وتحويلات مالية',
    icon: TrendingUp,
    keywords: ['صافي', 'ربح', 'عجز', 'تحويل'],
  },
  {
    id: 'assets',
    name: 'أصول ومصاريف خاصة',
    icon: ShoppingCart,
    keywords: ['assets', 'أصول'],
  },
];

export const EXPENSE_CATEGORY_OTHER_GROUP_ID = 'other';

export const EXPENSE_CATEGORY_OTHER_GROUP: ExpenseCategoryGroupDef = {
  id: EXPENSE_CATEGORY_OTHER_GROUP_ID,
  name: 'مصروفات أخرى',
  icon: Briefcase,
  keywords: [],
};

export interface GroupedExpenseCategories<T extends { CatName: string }> {
  groupId: string;
  group: ExpenseCategoryGroupDef;
  categories: T[];
}

export function assignExpenseCategoryGroupId(catName: string): string {
  const catNameLower = catName.toLowerCase();

  for (const group of EXPENSE_CATEGORY_GROUPS) {
    if (group.keywords.some((keyword) => catNameLower.includes(keyword))) {
      return group.id;
    }
  }

  return EXPENSE_CATEGORY_OTHER_GROUP_ID;
}

export function groupExpenseCategories<T extends { CatName: string }>(
  categories: T[],
): GroupedExpenseCategories<T>[] {
  const buckets = new Map<string, T[]>();

  for (const category of categories) {
    const groupId = assignExpenseCategoryGroupId(category.CatName);
    const existing = buckets.get(groupId) ?? [];
    existing.push(category);
    buckets.set(groupId, existing);
  }

  const orderedGroupIds = [
    ...EXPENSE_CATEGORY_GROUPS.map((group) => group.id),
    EXPENSE_CATEGORY_OTHER_GROUP_ID,
  ];

  return orderedGroupIds
    .map((groupId) => {
      const items = buckets.get(groupId);
      if (!items?.length) return null;

      const group =
        EXPENSE_CATEGORY_GROUPS.find((entry) => entry.id === groupId) ??
        EXPENSE_CATEGORY_OTHER_GROUP;

      return {
        groupId,
        group,
        categories: items,
      };
    })
    .filter((entry): entry is GroupedExpenseCategories<T> => entry !== null);
}

/** Extract employee or subgroup label from names like "سلفة (كريم)". */
export function extractExpenseCategorySecondaryLabel(catName: string): string | null {
  const match = catName.match(/\(([^)]+)\)/);
  return match?.[1]?.trim() ?? null;
}

export const QUICK_EXPENSE_DAILY_PINNED_NAMES = [
  'بضاعة',
  'توصيل',
  'اشتراكات شهرية',
  'تحويلات',
] as const;

export const QUICK_EXPENSE_ADVANCES_GROUP_ID = 'advances';
