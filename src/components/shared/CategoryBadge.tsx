'use client';

import { getCategoryTheme, CategoryTheme } from '@/lib/categoryTheme';

// ─────────────────────────────────────────────────────────────────────────────
// All components use inline styles from categoryTheme.ts — NOT Tailwind dynamic
// classes — so colors always render regardless of Tailwind's JIT purging.
// ─────────────────────────────────────────────────────────────────────────────

// ── CategoryBadge ─────────────────────────────────────────────────────────────

interface CategoryBadgeProps {
  name: string | null | undefined;
  catId?: number | null;
  theme?: CategoryTheme;
  size?: 'sm' | 'md' | 'lg';
  showEmoji?: boolean;
}

export function CategoryBadge({
  name,
  catId,
  theme: themeProp,
  size = 'md',
  showEmoji = true,
}: CategoryBadgeProps) {
  const theme = themeProp ?? getCategoryTheme(name, catId);

  const padding =
    size === 'sm' ? '2px 8px' :
    size === 'lg' ? '5px 14px' :
                   '3px 10px';
  const fontSize =
    size === 'sm' ? '11px' :
    size === 'lg' ? '13px' :
                   '12px';

  if (!name) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding, fontSize, fontWeight: 500, borderRadius: '9999px',
        backgroundColor: 'color-mix(in srgb, var(--muted-foreground) 15%, transparent)',
        border: '1px solid color-mix(in srgb, var(--muted-foreground) 35%, transparent)',
        color: 'var(--muted-foreground)',
        whiteSpace: 'nowrap',
      }}>
        بدون فئة
      </span>
    );
  }

  return (
    <span style={{ ...theme.badgeStyle, padding, fontSize }}>
      {showEmoji && (
        <span style={{ fontSize: '12px', lineHeight: 1 }}>{theme.emoji}</span>
      )}
      {name}
    </span>
  );
}

// ── SubcategoryBadge ──────────────────────────────────────────────────────────

interface SubcategoryBadgeProps {
  name: string | null | undefined;
  parentName?: string | null;
  catId?: number | null;
  theme?: CategoryTheme;
  showConnector?: boolean;
}

export function SubcategoryBadge({
  name,
  parentName,
  catId,
  theme: themeProp,
  showConnector = true,
}: SubcategoryBadgeProps) {
  const theme = themeProp ?? getCategoryTheme(parentName ?? name, catId);
  if (!name) return null;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      {showConnector && (
        <span style={{ fontSize: '10px', opacity: 0.6, color: theme.color }}>↳</span>
      )}
      <span style={{ ...theme.subBadgeStyle, padding: '1px 7px', fontSize: '10px' }}>
        {name}
      </span>
    </span>
  );
}

// ── CategoryWithSub ───────────────────────────────────────────────────────────

interface CategoryWithSubProps {
  catName: string | null | undefined;
  subName?: string | null;
  catId?: number | null;
  size?: 'sm' | 'md' | 'lg';
  inline?: boolean;
}

export function CategoryWithSub({ catName, subName, catId, size = 'md', inline = false }: CategoryWithSubProps) {
  const theme = getCategoryTheme(catName, catId);
  return (
    <div style={{ display: inline ? 'inline-flex' : 'flex', flexDirection: inline ? 'row' : 'column', alignItems: inline ? 'center' : 'flex-start', gap: '4px' }}>
      <CategoryBadge name={catName} catId={catId} theme={theme} size={size} />
      {subName && <SubcategoryBadge name={subName} theme={theme} showConnector={!inline} />}
    </div>
  );
}

// ── CategoryDot ───────────────────────────────────────────────────────────────

interface CategoryDotProps {
  catName: string | null | undefined;
  catId?: number | null;
  size?: number;
}

export function CategoryDot({ catName, catId, size = 8 }: CategoryDotProps) {
  const theme = getCategoryTheme(catName, catId);
  return (
    <span style={{
      display: 'inline-block',
      width: size, height: size,
      borderRadius: '9999px',
      flexShrink: 0,
      ...theme.dotStyle,
    }} />
  );
}

// ── CategoryLabel ─────────────────────────────────────────────────────────────

interface CategoryLabelProps {
  catName: string | null | undefined;
  subName?: string | null;
  catId?: number | null;
}

export function CategoryLabel({ catName, subName, catId }: CategoryLabelProps) {
  const theme = getCategoryTheme(catName, catId);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ width: 3, height: 32, borderRadius: '9999px', flexShrink: 0, ...theme.dotStyle }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: theme.color }}>{catName ?? 'بدون فئة'}</span>
        {subName && (
          <span style={{ fontSize: '10px', color: theme.color, opacity: 0.75 }}>{subName}</span>
        )}
      </div>
    </div>
  );
}
