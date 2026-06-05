'use client';

import { useState, useEffect } from 'react';
import {
  Store, Plus, Search, Filter, Edit, Copy, Power, Trash2,
  Package, Star, Clock, Tag, Image as ImageIcon, Eye
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

interface StoreItem {
  id: number;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  category: 'SERVICE' | 'PRODUCT' | 'DISCOUNT' | 'UPGRADE';
  itemType: 'VOUCHER' | 'INSTANT';
  priceCoins: number;
  value?: number;
  minimumTier: 'BRONZE' | 'SILVER' | 'GOLD' | 'VIP';
  expiryDays?: number;
  featured: boolean;
  badgeText?: string;
  imageUrl?: string;
  active: boolean;
  purchaseCount: number;
  stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
}

const categoryLabels = {
  SERVICE: 'خدمة',
  PRODUCT: 'منتج',
  DISCOUNT: 'خصم',
  UPGRADE: 'ترقية',
};

const categoryColors = {
  SERVICE: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  PRODUCT: 'bg-green-500/10 text-green-400 border-green-500/30',
  DISCOUNT: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  UPGRADE: 'bg-pink-500/10 text-pink-400 border-pink-500/30',
};

export default function StorePage() {
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedTier, setSelectedTier] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [showFeaturedOnly, setShowFeaturedOnly] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<StoreItem | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const mockItems: StoreItem[] = [
        {
          id: 1,
          nameAr: 'تسريحة مجانية',
          nameEn: 'Free Styling',
          descriptionAr: 'احصل على تسريحة شعر مجانية',
          descriptionEn: 'Get a free hair styling service',
          category: 'SERVICE',
          itemType: 'VOUCHER',
          priceCoins: 500,
          minimumTier: 'BRONZE',
          expiryDays: 30,
          featured: true,
          badgeText: 'الأكثر شعبية',
          active: true,
          purchaseCount: 145,
          stockStatus: 'IN_STOCK',
        },
        {
          id: 2,
          nameAr: 'ترقية VIP',
          nameEn: 'VIP Upgrade',
          descriptionAr: 'ترقية فورية إلى مستوى VIP',
          descriptionEn: 'Instant upgrade to VIP tier',
          category: 'UPGRADE',
          itemType: 'INSTANT',
          priceCoins: 1000,
          minimumTier: 'GOLD',
          featured: true,
          badgeText: 'حصري',
          active: true,
          purchaseCount: 28,
          stockStatus: 'IN_STOCK',
        },
        {
          id: 3,
          nameAr: 'خصم 20%',
          nameEn: '20% Discount',
          descriptionAr: 'خصم 20% على الزيارة القادمة',
          descriptionEn: '20% discount on next visit',
          category: 'DISCOUNT',
          itemType: 'VOUCHER',
          priceCoins: 300,
          value: 20,
          minimumTier: 'BRONZE',
          expiryDays: 15,
          featured: false,
          active: true,
          purchaseCount: 89,
          stockStatus: 'IN_STOCK',
        },
        {
          id: 4,
          nameAr: 'منتج العناية بالشعر',
          nameEn: 'Hair Care Product',
          descriptionAr: 'منتج عناية بالشعر مميز',
          descriptionEn: 'Premium hair care product',
          category: 'PRODUCT',
          itemType: 'VOUCHER',
          priceCoins: 800,
          minimumTier: 'SILVER',
          expiryDays: 60,
          featured: false,
          active: true,
          purchaseCount: 34,
          stockStatus: 'LOW_STOCK',
        },
      ];

      setItems(mockItems);
    } catch (error) {
      console.error('Failed to fetch store items:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const filteredItems = items.filter((item) => {
    if (searchQuery && !item.nameAr.includes(searchQuery) && !item.nameEn.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (selectedCategory && item.category !== selectedCategory) return false;
    if (selectedTier && item.minimumTier !== selectedTier) return false;
    if (selectedStatus === 'ACTIVE' && !item.active) return false;
    if (selectedStatus === 'INACTIVE' && item.active) return false;
    if (showFeaturedOnly && !item.featured) return false;
    return true;
  });

  const openNewItemModal = () => {
    setEditingItem(null);
    setModalOpen(true);
  };

  const openEditModal = (item: StoreItem) => {
    setEditingItem(item);
    setModalOpen(true);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ar-EG').format(num);
  };

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
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-full md:w-40 bg-zinc-800 border-zinc-700">
                <SelectValue placeholder="التصنيف" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                <SelectItem value="">الكل</SelectItem>
                <SelectItem value="SERVICE">خدمة</SelectItem>
                <SelectItem value="PRODUCT">منتج</SelectItem>
                <SelectItem value="DISCOUNT">خصم</SelectItem>
                <SelectItem value="UPGRADE">ترقية</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedTier} onValueChange={setSelectedTier}>
              <SelectTrigger className="w-full md:w-40 bg-zinc-800 border-zinc-700">
                <SelectValue placeholder="المستوى" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                <SelectItem value="">الكل</SelectItem>
                <SelectItem value="BRONZE">BRONZE</SelectItem>
                <SelectItem value="SILVER">SILVER</SelectItem>
                <SelectItem value="GOLD">GOLD</SelectItem>
                <SelectItem value="VIP">VIP</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="w-full md:w-40 bg-zinc-800 border-zinc-700">
                <SelectValue placeholder="الحالة" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                <SelectItem value="">الكل</SelectItem>
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
              <PremiumCard key={item.id} hover noPadding>
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
                  
                  {item.featured && item.badgeText && (
                    <div className="absolute top-3 right-3">
                      <Badge className="bg-yellow-500 text-black font-semibold border-0">
                        <Star className="h-3 w-3 ml-1" />
                        {item.badgeText}
                      </Badge>
                    </div>
                  )}

                  {!item.active && (
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
                  </div>

                  <p className="text-sm text-zinc-300 line-clamp-2">
                    {item.descriptionAr}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <Badge className={`${categoryColors[item.category]} border font-medium`}>
                      {categoryLabels[item.category]}
                    </Badge>
                    <TierBadge tier={item.minimumTier} size="sm" />
                    {item.expiryDays && (
                      <Badge variant="outline" className="text-zinc-400 border-zinc-700">
                        <Clock className="h-3 w-3 ml-1" />
                        {item.expiryDays} يوم
                      </Badge>
                    )}
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
                        {formatNumber(item.purchaseCount)}
                      </p>
                      <p className="text-xs text-zinc-500">عملية شراء</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 text-blue-400 hover:text-blue-300 hover:bg-blue-400/10"
                    >
                      <Eye className="w-4 h-4 ml-1" />
                      عرض
                    </Button>
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
                      className="text-zinc-400 hover:text-zinc-300 hover:bg-zinc-700"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`${
                        item.active
                          ? 'text-red-400 hover:text-red-300 hover:bg-red-400/10'
                          : 'text-green-400 hover:text-green-300 hover:bg-green-400/10'
                      }`}
                    >
                      <Power className="w-4 h-4" />
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

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>الاسم بالعربية</Label>
                <Input
                  placeholder="تسريحة مجانية"
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
              <div className="space-y-2">
                <Label>الاسم بالإنجليزية</Label>
                <Input
                  placeholder="Free Styling"
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>الوصف بالعربية</Label>
                <Textarea
                  placeholder="وصف المنتج..."
                  className="bg-zinc-800 border-zinc-700"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>الوصف بالإنجليزية</Label>
                <Textarea
                  placeholder="Product description..."
                  className="bg-zinc-800 border-zinc-700"
                  rows={3}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>التصنيف</Label>
                <Select defaultValue="SERVICE">
                  <SelectTrigger className="bg-zinc-800 border-zinc-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    <SelectItem value="SERVICE">خدمة</SelectItem>
                    <SelectItem value="PRODUCT">منتج</SelectItem>
                    <SelectItem value="DISCOUNT">خصم</SelectItem>
                    <SelectItem value="UPGRADE">ترقية</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>نوع المنتج</Label>
                <Select defaultValue="VOUCHER">
                  <SelectTrigger className="bg-zinc-800 border-zinc-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    <SelectItem value="VOUCHER">قسيمة</SelectItem>
                    <SelectItem value="INSTANT">فوري</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>السعر (نقاط)</Label>
                <Input
                  type="number"
                  placeholder="500"
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>الحد الأدنى للمستوى</Label>
                <Select defaultValue="BRONZE">
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
                  placeholder="30"
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
              <div className="space-y-2">
                <Label>القيمة (اختياري)</Label>
                <Input
                  type="number"
                  placeholder="20"
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>نص الشارة (اختياري)</Label>
              <Input
                placeholder="الأكثر شعبية"
                className="bg-zinc-800 border-zinc-700"
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
              <div>
                <Label>مميز</Label>
                <p className="text-xs text-zinc-400">عرض في القائمة المميزة</p>
              </div>
              <Switch />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
              <div>
                <Label>نشط</Label>
                <p className="text-xs text-zinc-400">متاح للشراء</p>
              </div>
              <Switch defaultChecked />
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
              >
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
