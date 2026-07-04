'use client';

import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Search,
  Star,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  assignExpenseCategoryGroupId,
  EXPENSE_CATEGORY_GROUPS,
  extractExpenseCategorySecondaryLabel,
  groupExpenseCategories,
  QUICK_EXPENSE_ADVANCES_GROUP_ID,
} from '@/lib/expenseCategoryGroups';
import {
  filterExpenseCategories,
  resolveQuickExpenseDailyPinnedCategories,
} from '@/lib/expenseCategorySearch';

export interface ExpenseCategoryOption {
  ExpINID: number;
  CatName: string;
  UsageCount?: number;
  DailyUsageCount?: number;
}

interface ExpenseCategoryPickerProps {
  categories: ExpenseCategoryOption[];
  selectedId: number | null;
  onSelect: (categoryId: number) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  disabled?: boolean;
  categoryError?: string | null;
  variant?: 'default' | 'quick';
}

const COLLAPSED_THRESHOLD = 9;
const VISIBLE_WHEN_COLLAPSED = 6;
const FREQUENTLY_USED_LIMIT = 6;

function CategorySkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="h-10 animate-pulse rounded-lg bg-surface-muted" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-9 w-28 animate-pulse rounded-full bg-surface-muted"
          />
        ))}
      </div>
      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className="space-y-2 rounded-xl border border-border p-3">
          <div className="h-5 w-40 animate-pulse rounded bg-surface-muted" />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {Array.from({ length: 3 }).map((__, cellIndex) => (
              <div
                key={cellIndex}
                className="h-12 animate-pulse rounded-lg bg-surface-muted"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CategoryOptionButton({
  category,
  selected,
  onSelect,
  disabled,
}: {
  category: ExpenseCategoryOption;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  const secondaryLabel = extractExpenseCategorySecondaryLabel(category.CatName);
  const displayName = secondaryLabel
    ? category.CatName.replace(/\([^)]+\)/, '').trim()
    : category.CatName;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex min-h-[48px] w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-right transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
        selected
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border bg-surface-muted/40 text-foreground hover:border-primary/40 hover:bg-surface-muted',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug">{displayName}</span>
        {secondaryLabel ? (
          <span className="mt-0.5 block text-xs text-muted-foreground">{secondaryLabel}</span>
        ) : null}
      </span>
      {selected ? (
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
      ) : null}
    </button>
  );
}

function CategoryGroupCard({
  groupName,
  groupIcon: GroupIcon,
  categories,
  selectedId,
  onSelect,
  disabled,
}: {
  groupName: string;
  groupIcon: React.ComponentType<{ className?: string }>;
  categories: ExpenseCategoryOption[];
  selectedId: number | null;
  onSelect: (categoryId: number) => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(categories.length <= COLLAPSED_THRESHOLD);
  const visibleCategories = expanded
    ? categories
    : categories.slice(0, VISIBLE_WHEN_COLLAPSED);
  const hiddenCount = categories.length - visibleCategories.length;

  return (
    <section className="rounded-xl border border-border bg-surface-muted/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted">
            <GroupIcon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-foreground">{groupName}</h4>
            <p className="text-xs text-muted-foreground">
              {categories.length} {categories.length === 1 ? 'تصنيف' : 'تصنيفات'}
            </p>
          </div>
        </div>
        {categories.length > COLLAPSED_THRESHOLD ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                عرض أقل
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                عرض الكل
              </>
            )}
          </button>
        ) : null}
      </div>

      <div
        role="radiogroup"
        aria-label={groupName}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
      >
        {visibleCategories.map((category) => (
          <CategoryOptionButton
            key={category.ExpINID}
            category={category}
            selected={selectedId === category.ExpINID}
            onSelect={() => onSelect(category.ExpINID)}
            disabled={disabled}
          />
        ))}
      </div>

      {!expanded && hiddenCount > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">+{hiddenCount} تصنيفات أخرى</p>
      ) : null}
    </section>
  );
}

export default function ExpenseCategoryPicker({
  categories,
  selectedId,
  onSelect,
  loading = false,
  error = null,
  onRetry,
  disabled = false,
  categoryError = null,
  variant = 'default',
}: ExpenseCategoryPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllCategories, setShowAllCategories] = useState(false);

  const isQuickVariant = variant === 'quick';

  const frequentlyUsed = useMemo(
    () =>
      categories
        .filter((category) => (category.UsageCount ?? 0) > 0)
        .slice(0, FREQUENTLY_USED_LIMIT),
    [categories],
  );

  const dailyPinnedCategories = useMemo(
    () => resolveQuickExpenseDailyPinnedCategories(categories),
    [categories],
  );

  const pinnedCategoryIds = useMemo(
    () => new Set(dailyPinnedCategories.map((category) => category.ExpINID)),
    [dailyPinnedCategories],
  );

  const filteredCategories = useMemo(
    () => filterExpenseCategories(categories, searchQuery),
    [categories, searchQuery],
  );

  const groupedCategories = useMemo(
    () => groupExpenseCategories(filteredCategories),
    [filteredCategories],
  );

  const quickAdvancesGroup = useMemo(() => {
    const advancesCategories = categories.filter(
      (category) =>
        assignExpenseCategoryGroupId(category.CatName) === QUICK_EXPENSE_ADVANCES_GROUP_ID &&
        !pinnedCategoryIds.has(category.ExpINID),
    );
    if (advancesCategories.length === 0) return null;

    const group = EXPENSE_CATEGORY_GROUPS.find(
      (entry) => entry.id === QUICK_EXPENSE_ADVANCES_GROUP_ID,
    );
    if (!group) return null;

    return { group, categories: advancesCategories };
  }, [categories, pinnedCategoryIds]);

  const collapsedHiddenGroups = useMemo(() => {
    return groupedCategories
      .filter((entry) => entry.groupId !== QUICK_EXPENSE_ADVANCES_GROUP_ID)
      .map((entry) => ({
        ...entry,
        categories: entry.categories.filter((category) => !pinnedCategoryIds.has(category.ExpINID)),
      }))
      .filter((entry) => entry.categories.length > 0);
  }, [groupedCategories, pinnedCategoryIds]);

  const isSearching = searchQuery.trim().length > 0;

  if (loading) {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">تصنيف المصروف</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            اختر التصنيف الذي يصف المصروف بدقة
          </p>
        </div>
        <CategorySkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">تصنيف المصروف</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            اختر التصنيف الذي يصف المصروف بدقة
          </p>
        </div>
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-center">
          <p className="text-sm text-destructive">{error}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
            >
              إعادة المحاولة
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">تصنيف المصروف</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            اختر التصنيف الذي يصف المصروف بدقة
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground">لا توجد تصنيفات متاحة حاليًا</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-foreground">تصنيف المصروف</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          اختر التصنيف الذي يصف المصروف بدقة
        </p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="ابحث عن تصنيف أو اسم موظف..."
          disabled={disabled}
          className="w-full rounded-xl border border-border bg-surface-muted py-2.5 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        />
        {searchQuery ? (
          <button
            type="button"
            aria-label="مسح البحث"
            onClick={() => setSearchQuery('')}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {!isSearching && isQuickVariant && dailyPinnedCategories.length > 0 ? (
        <section aria-label="الأكثر استخدامًا اليوم" className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Star className="h-4 w-4 text-amber-400" />
            <span>الأكثر استخدامًا اليوم</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {dailyPinnedCategories.map((category) => {
              const selected = selectedId === category.ExpINID;
              return (
                <button
                  key={category.ExpINID}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => onSelect(category.ExpINID)}
                  className={cn(
                    'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                    selected
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-surface-muted/50 text-foreground hover:border-primary/40',
                    disabled && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <Star
                    className={cn(
                      'h-3.5 w-3.5',
                      selected ? 'fill-amber-400 text-amber-400' : 'text-amber-400/80',
                    )}
                  />
                  <span>{category.CatName}</span>
                  {(category.DailyUsageCount ?? 0) > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      ({category.DailyUsageCount})
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {!isSearching && !isQuickVariant && frequentlyUsed.length > 0 ? (
        <section aria-label="الأكثر استخدامًا" className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Star className="h-4 w-4 text-amber-400" />
            <span>الأكثر استخدامًا</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {frequentlyUsed.map((category) => {
              const selected = selectedId === category.ExpINID;
              return (
                <button
                  key={category.ExpINID}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => onSelect(category.ExpINID)}
                  className={cn(
                    'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                    selected
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-surface-muted/50 text-foreground hover:border-primary/40',
                    disabled && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <Star
                    className={cn(
                      'h-3.5 w-3.5',
                      selected ? 'fill-amber-400 text-amber-400' : 'text-amber-400/80',
                    )}
                  />
                  <span>{category.CatName}</span>
                  {(category.UsageCount ?? 0) > 0 ? (
                    <span className="text-xs text-muted-foreground">({category.UsageCount})</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {isSearching && filteredCategories.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-muted/30 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">لا توجد تصنيفات مطابقة</p>
        </div>
      ) : isSearching ? (
        <div
          role="radiogroup"
          aria-label="نتائج البحث"
          className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
        >
          {filteredCategories.map((category) => (
            <CategoryOptionButton
              key={category.ExpINID}
              category={category}
              selected={selectedId === category.ExpINID}
              onSelect={() => onSelect(category.ExpINID)}
              disabled={disabled}
            />
          ))}
        </div>
      ) : isQuickVariant ? (
        <div className="space-y-3">
          {quickAdvancesGroup ? (
            <CategoryGroupCard
              groupName={quickAdvancesGroup.group.name}
              groupIcon={quickAdvancesGroup.group.icon}
              categories={quickAdvancesGroup.categories}
              selectedId={selectedId}
              onSelect={onSelect}
              disabled={disabled}
            />
          ) : null}

          {!showAllCategories && collapsedHiddenGroups.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowAllCategories(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface-muted/20 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-surface-muted/40"
            >
              <ChevronDown className="h-4 w-4" />
              عرض كل الفئات
            </button>
          ) : null}

          {showAllCategories ? (
            <>
              {collapsedHiddenGroups.map(({ groupId, group, categories: groupCategories }) => (
                <CategoryGroupCard
                  key={groupId}
                  groupName={group.name}
                  groupIcon={group.icon}
                  categories={groupCategories}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  disabled={disabled}
                />
              ))}
              <button
                type="button"
                onClick={() => setShowAllCategories(false)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-muted/20 px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted/40"
              >
                <ChevronUp className="h-4 w-4" />
                إخفاء الفئات الأخرى
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {groupedCategories.map(({ groupId, group, categories: groupCategories }) => (
            <CategoryGroupCard
              key={groupId}
              groupName={group.name}
              groupIcon={group.icon}
              categories={groupCategories}
              selectedId={selectedId}
              onSelect={onSelect}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      {categoryError ? (
        <p className="text-xs text-destructive" role="alert">
          {categoryError}
        </p>
      ) : null}
    </div>
  );
}
