'use client';

import { useState, useMemo } from 'react';
import { Search, Star, Users, Briefcase, ShoppingCart, Package, Calendar, TrendingUp, Wallet, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ExpenseCategory {
  ExpINID: number;
  CatName: string;
  UsageCount: number;
}

interface SmartExpenseCategoryPickerProps {
  categories: ExpenseCategory[];
  onSelect: (categoryId: number, categoryName: string) => void;
  currentCategory?: string;
}

// Category group definitions with icons and colors
const CATEGORY_GROUPS = [
  {
    id: 'advances',
    name: 'سلف وخصومات شخصية',
    icon: Users,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 hover:bg-blue-100',
    borderColor: 'border-blue-200',
    keywords: ['سلفة', 'سلف'],
  },
  {
    id: 'payroll',
    name: 'رواتب ومكافآت',
    icon: Wallet,
    color: 'text-green-600',
    bgColor: 'bg-green-50 hover:bg-green-100',
    borderColor: 'border-green-200',
    keywords: ['مرتبات', 'راتب', 'رواتب', 'تارجت', 'مكافأة', 'حوافز'],
  },
  {
    id: 'operational',
    name: 'مصروفات تشغيلية',
    icon: Briefcase,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 hover:bg-purple-100',
    borderColor: 'border-purple-200',
    keywords: ['بوفيه', 'تنظيف', 'توصيل', 'كهرباء', 'مياه', 'تكاليف', 'نسبة', 'مصاريف'],
  },
  {
    id: 'inventory',
    name: 'بضاعة ومشتريات',
    icon: Package,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50 hover:bg-orange-100',
    borderColor: 'border-orange-200',
    keywords: ['بضاعة'],
  },
  {
    id: 'recurring',
    name: 'التزامات دورية',
    icon: Calendar,
    color: 'text-cyan-600',
    bgColor: 'bg-cyan-50 hover:bg-cyan-100',
    borderColor: 'border-cyan-200',
    keywords: ['اشتراكات', 'جمعيات', 'أقساط', 'قسط'],
  },
  {
    id: 'settlements',
    name: 'تسويات وتحويلات مالية',
    icon: TrendingUp,
    color: 'text-red-600',
    bgColor: 'bg-red-50 hover:bg-red-100',
    borderColor: 'border-red-200',
    keywords: ['صافي', 'ربح', 'عجز', 'تحويل'],
  },
  {
    id: 'assets',
    name: 'أصول ومصاريف خاصة',
    icon: ShoppingCart,
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50 hover:bg-indigo-100',
    borderColor: 'border-indigo-200',
    keywords: ['assets', 'أصول'],
  },
];

export default function SmartExpenseCategoryPicker({
  categories,
  onSelect,
  currentCategory,
}: SmartExpenseCategoryPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  // Filter out problematic categories
  const validCategories = categories.filter(
    (cat) =>
      cat.CatName !== 'تحويلات' &&
      cat.CatName !== 'سلف' &&
      cat.CatName !== 'مرتبات الصنايعية' &&
      cat.CatName !== 'اقساط'
  );

  // Get most used categories (top 5)
  const mostUsed = validCategories.filter((cat) => cat.UsageCount > 0).slice(0, 5);

  // Categorize items into groups
  const categorizedItems = useMemo(() => {
    const grouped: Record<string, ExpenseCategory[]> = {};
    const uncategorized: ExpenseCategory[] = [];

    validCategories.forEach((cat) => {
      const catNameLower = cat.CatName.toLowerCase();
      let assigned = false;

      for (const group of CATEGORY_GROUPS) {
        if (group.keywords.some((keyword) => catNameLower.includes(keyword))) {
          if (!grouped[group.id]) {
            grouped[group.id] = [];
          }
          grouped[group.id].push(cat);
          assigned = true;
          break;
        }
      }

      if (!assigned) {
        uncategorized.push(cat);
      }
    });

    // Sort items within each group by usage count
    Object.keys(grouped).forEach((groupId) => {
      grouped[groupId].sort((a, b) => b.UsageCount - a.UsageCount);
    });

    return { grouped, uncategorized };
  }, [validCategories]);

  // Filter categories based on search
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return categorizedItems;

    const query = searchQuery.toLowerCase();
    const filtered: Record<string, ExpenseCategory[]> = {};

    Object.entries(categorizedItems.grouped).forEach(([groupId, items]) => {
      const matchedItems = items.filter((cat) => cat.CatName.toLowerCase().includes(query));
      if (matchedItems.length > 0) {
        filtered[groupId] = matchedItems;
      }
    });

    return { grouped: filtered, uncategorized: [] };
  }, [categorizedItems, searchQuery]);

  const handleCategorySelect = (cat: ExpenseCategory) => {
    onSelect(cat.ExpINID, cat.CatName);
  };

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="ابحث عن فئة أو اسم شخص..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pr-10 pl-3 py-2 border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Quick Picks - Most Used */}
      {!searchQuery && mostUsed.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Star className="h-4 w-4 text-amber-500" />
            <span>الأكثر استخداماً</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {mostUsed.map((cat) => (
              <button
                key={cat.ExpINID}
                onClick={() => handleCategorySelect(cat)}
                className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-full text-sm font-medium text-amber-900 transition-colors flex items-center gap-1.5"
              >
                <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                {cat.CatName}
                <span className="text-xs text-amber-600">({cat.UsageCount})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Category Groups */}
      {!selectedGroup ? (
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">اختر المجموعة:</div>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORY_GROUPS.map((group) => {
              const itemCount = filteredCategories.grouped[group.id]?.length || 0;
              if (searchQuery && itemCount === 0) return null;

              const Icon = group.icon;
              return (
                <button
                  key={group.id}
                  onClick={() => setSelectedGroup(group.id)}
                  className={`p-3 border rounded-lg transition-all text-right ${group.bgColor} ${group.borderColor}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className={`h-5 w-5 ${group.color}`} />
                    <span className="font-medium text-sm text-black dark:text-black">{group.name}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {itemCount} {itemCount === 1 ? 'فئة' : 'فئات'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        // Show items in selected group
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => setSelectedGroup(null)} className="gap-2">
              ← رجوع للمجموعات
            </Button>
            <div className="text-sm font-medium">
              {CATEGORY_GROUPS.find((g) => g.id === selectedGroup)?.name}
            </div>
          </div>

          <div className="space-y-1 max-h-64 overflow-y-auto">
            {filteredCategories.grouped[selectedGroup]?.map((cat) => (
              <button
                key={cat.ExpINID}
                onClick={() => handleCategorySelect(cat)}
                className={`w-full p-2 text-right rounded-md border transition-colors ${
                  cat.CatName === currentCategory
                    ? 'bg-primary/10 border-primary text-primary font-medium'
                    : 'bg-card hover:bg-muted border-border'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm">{cat.CatName}</span>
                  {cat.UsageCount > 0 && (
                    <span className="text-xs text-muted-foreground">({cat.UsageCount})</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* No results */}
      {searchQuery && Object.keys(filteredCategories.grouped).length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-sm">لا توجد نتائج للبحث "{searchQuery}"</p>
        </div>
      )}
    </div>
  );
}
