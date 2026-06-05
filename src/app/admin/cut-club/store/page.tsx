'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Store, Plus, Search, Edit, Power, Trash2,
  Package, Star, Clock, Image as ImageIcon, Loader2
} from 'lucide-react';
import PageHeader from '@/components/cut-club/PageHeader';
import PremiumCard from '@/components/cut-club/PremiumCard';
import EmptyState from '@/components/cut-club/EmptyState';
import { CardSkeleton } from '@/components/cut-club/LoadingSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import TierBadge from '@/components/cut-club/TierBadge';

interface ApiStoreItem {
  itemId: number;
  categoryId: number;
  code: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  itemType: string;
  priceCoins: number;
  value: number | null;
  serviceId: number | null;
  productId: number | null;
  minTierCode: string | null;
  stockQuantity: number | null;
  unlimitedStock: boolean;
  expiresAfterDays: number | null;
  imageUrl: string | null;
  badgeText: string | null;
  isFeatured: boolean;
  isActive: boolean;
  sortOrder: number;
}

interface StoreCategory {
  categoryId: number;
  code: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
}

const itemTypeLabels: Record<string, string> = {
  DISCOUNT_AMOUNT: 'خصم مبلغ',
  DISCOUNT_PERCENT: 'خصم %',
  FREE_SERVICE: 'خدمة مجانية',
  FREE_PRODUCT: 'منتج مجاني',
  DOUBLE_POINTS: 'نقاط مضاعفة',
  BONUS_POINTS: 'نقاط إضافية',
  VIP_UPGRADE: 'ترقية VIP',
  PRIORITY_BOOKING: 'حجز أولوية',
  MYSTERY_BOX: 'صندوق غموض',
  CUSTOM: 'مخصص',
};

const itemTypeColors: Record<string, string> = {
  DISCOUNT_AMOUNT: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  DISCOUNT_PERCENT: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  FREE_SERVICE: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  FREE_PRODUCT: 'bg-green-500/10 text-green-400 border-green-500/30',
  DOUBLE_POINTS: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  BONUS_POINTS: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  VIP_UPGRADE: 'bg-pink-500/10 text-pink-400 border-pink-500/30',
  PRIORITY_BOOKING: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  MYSTERY_BOX: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  CUSTOM: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
};

function getStockStatus(item: ApiStoreItem): 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' {
  if (item.unlimitedStock) return 'IN_STOCK';
  if (item.stockQuantity === null || item.stockQuantity === 0) return 'OUT_OF_STOCK';
  if (item.stockQuantity < 10) return 'LOW_STOCK';
  return 'IN_STOCK';
}

function getTierCode(tier: string | null): string {
  return tier || 'BRONZE';
}

export default function StorePage() {
  const [items, setItems] = useState<ApiStoreItem[]>([]);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItemType, setSelectedItemType] = useState('');
  const [selectedTier, setSelectedTier] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [showFeaturedOnly, setShowFeaturedOnly] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ApiStoreItem | null>(null);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    categoryId: 1,
    code: '',
    nameAr: '',
    nameEn: '',
    descriptionAr: '',
    descriptionEn: '',
    itemType: 'DISCOUNT_AMOUNT',
    priceCoins: 0,
    value: null as number | null,
    minTierCode: 'BRONZE' as string | null,
    stockQuantity: null as number | null,
    unlimitedStock: false,
    expiresAfterDays: null as number | null,
    imageUrl: '',
    badgeText: '',
    isFeatured: false,
    isActive: true,
    sortOrder: 0,
  });

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [itemsRes, catsRes] = await Promise.all([
        fetch('/api/admin/store/items'),
        fetch('/api/admin/store/categories'),
      ]);
      const itemsData = await itemsRes.json();
      const catsData = await catsRes.json();
      if (itemsData.ok) setItems(itemsData.items);
      if (catsData.ok) setCategories(catsData.categories);
    } catch {
      setError('فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const filteredItems = items.filter((item) => {
    const q = searchQuery.toLowerCase();
    if (searchQuery && !item.nameAr.includes(searchQuery) && !item.nameEn.toLowerCase().includes(q) && !item.code.toLowerCase().includes(q)) {
      return false;
    }
    if (selectedItemType && item.itemType !== selectedItemType) return false;
    if (selectedTier && item.minTierCode !== selectedTier) return false;
    if (selectedStatus === 'ACTIVE' && !item.isActive) return false;
    if (selectedStatus === 'INACTIVE' && item.isActive) return false;
    if (showFeaturedOnly && !item.isFeatured) return false;
    return true;
  });

  const openNewItemModal = () => {
    setEditingItem(null);
    setFormData({
      categoryId: categories[0]?.categoryId || 1,
      code: '',
      nameAr: '',
      nameEn: '',
      descriptionAr: '',
      descriptionEn: '',
      itemType: 'DISCOUNT_AMOUNT',
      priceCoins: 0,
      value: null,
      minTierCode: 'BRONZE',
      stockQuantity: null,
      unlimitedStock: false,
      expiresAfterDays: null,
      imageUrl: '',
      badgeText: '',
      isFeatured: false,
      isActive: true,
      sortOrder: 0,
    });
    setModalOpen(true);
  };

  const openEditModal = (item: ApiStoreItem) => {
    setEditingItem(item);
    setFormData({
      categoryId: item.categoryId,
      code: item.code,
      nameAr: item.nameAr,
      nameEn: item.nameEn,
      descriptionAr: item.descriptionAr,
      descriptionEn: item.descriptionEn,
      itemType: item.itemType,
      priceCoins: item.priceCoins,
      value: item.value,
      minTierCode: item.minTierCode,
      stockQuantity: item.stockQuantity,
      unlimitedStock: item.unlimitedStock,
      expiresAfterDays: item.expiresAfterDays,
      imageUrl: item.imageUrl || '',
      badgeText: item.badgeText || '',
      isFeatured: item.isFeatured,
      isActive: item.isActive,
      sortOrder: item.sortOrder,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      let ok = false;
      if (editingItem) {
        const res = await fetch(`/api/admin/store/items/${editingItem.itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
        const data = await res.json();
        ok = data.ok;
        if (!ok) setError(data.error || 'فشل التحديث');
      } else {
        const res = await fetch('/api/admin/store/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
        const data = await res.json();
        ok = data.ok;
        if (!ok) setError(data.error || 'فشل الإنشاء');
      }
      if (ok) {
        setModalOpen(false);
        fetchItems();
      }
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (item: ApiStoreItem) => {
    try {
      const res = await fetch(`/api/admin/store/items/${item.itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      const data = await res.json();
      if (data.ok) fetchItems();
    } catch {
      console.error('Toggle failed');
    }
  };

  const handleDelete = async (item: ApiStoreItem) => {
    if (!confirm('هل أنت متأكد من إلغاء تنشيط هذا المنتج؟')) return;
    try {
      const res = await fetch(`/api/admin/store/items/${item.itemId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) fetchItems();
    } catch {
      console.error('Delete failed');
    }
  };

  const formatNumber = (num: number) => new Intl.NumberFormat('ar-EG').format(num);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <PageHeader
        icon={Store}
        title="متجر CUT CLUB"
        description="إدارة جميع المكافآت والمنتجات المتاحة"
        gradient="from-blue-500/20 to-cyan-600/20"
        actions={
          <Button
            onClick={openNewItemModal}
            className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
          >
            <Plus className="w-4 h-4 ml-2" />
            منتج جديد
          </Button>
        }
      />

      <div className="px-4 sm:px-6 py-6 space-y-6">
        <PremiumCard>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <Input
                placeholder="بحث بالاسم..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-10 bg-zinc-800 border-zinc-700"
              />
            </div>
            <Select value={selectedItemType || '_all'} onValueChange={(v) => setSelectedItemType(v === '_all' ? '' : v)}>
              <SelectTrigger className="w-full md:w-48 bg-zinc-800 border-zinc-700">
                <SelectValue placeholder="نوع المنتج" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                <SelectItem value="_all">الكل</SelectItem>
                {Object.entries(itemTypeLabels).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedTier || '_all'} onValueChange={(v) => setSelectedTier(v === '_all' ? '' : v)}>
              <SelectTrigger className="w-full md:w-40 bg-zinc-800 border-zinc-700">
                <SelectValue placeholder="المستوى" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                <SelectItem value="_all">الكل</SelectItem>
                <SelectItem value="BRONZE">BRONZE</SelectItem>
                <SelectItem value="SILVER">SILVER</SelectItem>
                <SelectItem value="GOLD">GOLD</SelectItem>
                <SelectItem value="VIP">VIP</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedStatus || '_all'} onValueChange={(v) => setSelectedStatus(v === '_all' ? '' : v)}>
              <SelectTrigger className="w-full md:w-40 bg-zinc-800 border-zinc-700">
                <SelectValue placeholder="الحالة" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                <SelectItem value="_all">الكل</SelectItem>
                <SelectItem value="ACTIVE">نشط</SelectItem>
                <SelectItem value="INACTIVE">غير نشط</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch
                id="featured"
                checked={showFeaturedOnly}
                onCheckedChange={setShowFeaturedOnly}
              />
              <label htmlFor="featured" className="text-sm text-zinc-400 cursor-pointer whitespace-nowrap">
                مميز فقط
              </label>
            </div>
          </div>
        </PremiumCard>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <EmptyState
            icon={Package}
            title="لا توجد منتجات"
            description="لم يتم العثور على منتجات مطابقة للبحث"
            actionLabel="إضافة منتج جديد"
            onAction={openNewItemModal}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredItems.map((item) => (
              <PremiumCard key={item.itemId} hover noPadding>
                <div className="relative">
                  {item.imageUrl ? (
                    <div className="h-48 bg-zinc-800 rounded-t-xl overflow-hidden">
                      <img
                        src={item.imageUrl}
                        alt={item.nameAr}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="h-48 bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-t-xl flex items-center justify-center">
                      <ImageIcon className="h-16 w-16 text-zinc-600" />
                    </div>
                  )}

                  {item.isFeatured && item.badgeText && (
                    <div className="absolute top-3 right-3">
                      <Badge className="bg-yellow-500 text-black font-semibold border-0">
                        <Star className="h-3 w-3 ml-1" />
                        {item.badgeText}
                      </Badge>
                    </div>
                  )}

                  {!item.isActive && (
                    <div className="absolute inset-0 bg-black/60 rounded-t-xl flex items-center justify-center">
                      <Badge className="bg-red-500/90 text-white font-semibold">
                        غير نشط
                      </Badge>
                    </div>
                  )}
                </div>

                <div className="p-5 space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">{item.nameAr}</h3>
                    <p className="text-sm text-zinc-400">{item.nameEn}</p>
                    <p className="text-xs text-zinc-500 mt-1">{item.code}</p>
                  </div>

                  <p className="text-sm text-zinc-300 line-clamp-2">
                    {item.descriptionAr}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <Badge className={`${itemTypeColors[item.itemType] || itemTypeColors.CUSTOM} border font-medium`}>
                      {itemTypeLabels[item.itemType] || item.itemType}
                    </Badge>
                    <TierBadge tier={getTierCode(item.minTierCode)} size="sm" />
                    {item.expiresAfterDays && (
                      <Badge variant="outline" className="text-zinc-400 border-zinc-700">
                        <Clock className="h-3 w-3 ml-1" />
                        {item.expiresAfterDays} يوم
                      </Badge>
                    )}
                    <Badge variant="outline" className={`border ${getStockStatus(item) === 'OUT_OF_STOCK' ? 'text-red-400 border-red-700' : getStockStatus(item) === 'LOW_STOCK' ? 'text-yellow-400 border-yellow-700' : 'text-green-400 border-green-700'}`}>
                      {getStockStatus(item) === 'OUT_OF_STOCK' ? 'نفذ المخزون' : getStockStatus(item) === 'LOW_STOCK' ? 'مخزون منخفض' : 'متوفر'}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-zinc-800">
                    <div>
                      <p className="text-2xl font-bold text-yellow-400">
                        {formatNumber(item.priceCoins)}
                      </p>
                      <p className="text-xs text-zinc-500">نقطة</p>
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-white">
                        {item.unlimitedStock ? '∞' : formatNumber(item.stockQuantity || 0)}
                      </p>
                      <p className="text-xs text-zinc-500">المخزون</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditModal(item)}
                      className="flex-1 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/10"
                    >
                      <Edit className="w-4 h-4 ml-1" />
                      تعديل
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleActive(item)}
                      className={`${
                        item.isActive
                          ? 'text-red-400 hover:text-red-300 hover:bg-red-400/10'
                          : 'text-green-400 hover:text-green-300 hover:bg-green-400/10'
                      }`}
                    >
                      <Power className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(item)}
                      className="text-red-400 hover:text-red-300 hover:bg-red-400/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </PremiumCard>
            ))}
          </div>
        )}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              {editingItem ? 'تعديل منتج' : 'منتج جديد'}
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              {editingItem ? 'تعديل تفاصيل المنتج' : 'إضافة منتج جديد إلى المتجر'}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>الكود</Label>
                <Input
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="DISC-50"
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
              <div className="space-y-2">
                <Label>السعر (نقاط)</Label>
                <Input
                  type="number"
                  value={formData.priceCoins}
                  onChange={(e) => setFormData({ ...formData, priceCoins: parseFloat(e.target.value) || 0 })}
                  placeholder="500"
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>الاسم بالعربية</Label>
                <Input
                  value={formData.nameAr}
                  onChange={(e) => setFormData({ ...formData, nameAr: e.target.value })}
                  placeholder="تسريحة مجانية"
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
              <div className="space-y-2">
                <Label>الاسم بالإنجليزية</Label>
                <Input
                  value={formData.nameEn}
                  onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })}
                  placeholder="Free Styling"
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>الوصف بالعربية</Label>
                <Textarea
                  value={formData.descriptionAr}
                  onChange={(e) => setFormData({ ...formData, descriptionAr: e.target.value })}
                  placeholder="وصف المنتج..."
                  className="bg-zinc-800 border-zinc-700"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>الوصف بالإنجليزية</Label>
                <Textarea
                  value={formData.descriptionEn}
                  onChange={(e) => setFormData({ ...formData, descriptionEn: e.target.value })}
                  placeholder="Product description..."
                  className="bg-zinc-800 border-zinc-700"
                  rows={3}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>التصنيف</Label>
                <Select value={String(formData.categoryId)} onValueChange={(v) => setFormData({ ...formData, categoryId: parseInt(v) })}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {categories.map((cat) => (
                      <SelectItem key={cat.categoryId} value={String(cat.categoryId)}>{cat.nameAr}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>نوع المنتج</Label>
                <Select value={formData.itemType} onValueChange={(v) => setFormData({ ...formData, itemType: v })}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {Object.entries(itemTypeLabels).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>الحد الأدنى للمستوى</Label>
                <Select value={formData.minTierCode || 'BRONZE'} onValueChange={(v) => setFormData({ ...formData, minTierCode: v })}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    <SelectItem value="BRONZE">BRONZE</SelectItem>
                    <SelectItem value="SILVER">SILVER</SelectItem>
                    <SelectItem value="GOLD">GOLD</SelectItem>
                    <SelectItem value="VIP">VIP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>مدة الصلاحية (أيام)</Label>
                <Input
                  type="number"
                  value={formData.expiresAfterDays ?? ''}
                  onChange={(e) => setFormData({ ...formData, expiresAfterDays: e.target.value ? parseInt(e.target.value) : null })}
                  placeholder="30"
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
              <div className="space-y-2">
                <Label>القيمة (اختياري)</Label>
                <Input
                  type="number"
                  value={formData.value ?? ''}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value ? parseFloat(e.target.value) : null })}
                  placeholder="20"
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>المخزون</Label>
                <Input
                  type="number"
                  value={formData.stockQuantity ?? ''}
                  onChange={(e) => setFormData({ ...formData, stockQuantity: e.target.value ? parseInt(e.target.value) : null })}
                  placeholder="50"
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
              <div className="space-y-2">
                <Label>رابط الصورة (اختياري)</Label>
                <Input
                  value={formData.imageUrl}
                  onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                  placeholder="https://..."
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>نص الشارة (اختياري)</Label>
              <Input
                value={formData.badgeText}
                onChange={(e) => setFormData({ ...formData, badgeText: e.target.value })}
                placeholder="الأكثر شعبية"
                className="bg-zinc-800 border-zinc-700"
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
              <div>
                <Label>مخزون غير محدود</Label>
                <p className="text-xs text-zinc-400">لا يوجد حد للمخزون</p>
              </div>
              <Switch
                checked={formData.unlimitedStock}
                onCheckedChange={(v) => setFormData({ ...formData, unlimitedStock: v })}
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
              <div>
                <Label>مميز</Label>
                <p className="text-xs text-zinc-400">عرض في القائمة المميزة</p>
              </div>
              <Switch
                checked={formData.isFeatured}
                onCheckedChange={(v) => setFormData({ ...formData, isFeatured: v })}
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
              <div>
                <Label>نشط</Label>
                <p className="text-xs text-zinc-400">متاح للشراء</p>
              </div>
              <Switch
                checked={formData.isActive}
                onCheckedChange={(v) => setFormData({ ...formData, isActive: v })}
              />
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
                {editingItem ? 'حفظ التغييرات' : 'إضافة المنتج'}
              </Button>
              <Button
                variant="outline"
                className="flex-1 border-zinc-700 hover:bg-zinc-800"
                onClick={() => setModalOpen(false)}
              >
                إلغاء
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
