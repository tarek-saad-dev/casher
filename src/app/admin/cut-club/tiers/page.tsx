'use client';

import { useState, useEffect } from 'react';
import {
  Crown, Award, Star, Zap, Gift, Calendar, Users, TrendingUp,
  Edit, Save, X
} from 'lucide-react';
import PageHeader from '@/components/cut-club/PageHeader';
import PremiumCard from '@/components/cut-club/PremiumCard';
import { CardSkeleton } from '@/components/cut-club/LoadingSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';

interface TierBenefit {
  id: string;
  nameAr: string;
  nameEn: string;
  icon: string;
}

interface LoyaltyTier {
  code: string;
  nameAr: string;
  nameEn: string;
  requiredLifetimeCoins: number;
  multiplier: number;
  color: string;
  gradient: string;
  benefits: TierBenefit[];
  memberCount: number;
}

const tierIcons = {
  BRONZE: Award,
  SILVER: Star,
  GOLD: Crown,
  VIP: Zap,
};

export default function TiersPage() {
  const [tiers, setTiers] = useState<LoyaltyTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTier, setEditingTier] = useState<string | null>(null);

  const fetchTiers = async () => {
    setLoading(true);
    try {
      const mockTiers: LoyaltyTier[] = [
        {
          code: 'BRONZE',
          nameAr: 'برونزي',
          nameEn: 'Bronze',
          requiredLifetimeCoins: 0,
          multiplier: 1.0,
          color: 'text-amber-600',
          gradient: 'from-amber-700/20 to-amber-600/10',
          benefits: [
            { id: '1', nameAr: 'كسب النقاط الأساسية', nameEn: 'Basic Points Earning', icon: 'coins' },
            { id: '2', nameAr: 'الوصول إلى المتجر', nameEn: 'Store Access', icon: 'store' },
          ],
          memberCount: 245,
        },
        {
          code: 'SILVER',
          nameAr: 'فضي',
          nameEn: 'Silver',
          requiredLifetimeCoins: 1000,
          multiplier: 1.25,
          color: 'text-slate-400',
          gradient: 'from-slate-400/20 to-slate-500/10',
          benefits: [
            { id: '1', nameAr: 'مضاعف نقاط 1.25x', nameEn: '1.25x Points Multiplier', icon: 'trending' },
            { id: '2', nameAr: 'خصومات حصرية', nameEn: 'Exclusive Discounts', icon: 'tag' },
            { id: '3', nameAr: 'هدية عيد ميلاد', nameEn: 'Birthday Gift', icon: 'gift' },
          ],
          memberCount: 69,
        },
        {
          code: 'GOLD',
          nameAr: 'ذهبي',
          nameEn: 'Gold',
          requiredLifetimeCoins: 3000,
          multiplier: 1.5,
          color: 'text-yellow-500',
          gradient: 'from-yellow-500/20 to-yellow-600/10',
          benefits: [
            { id: '1', nameAr: 'مضاعف نقاط 1.5x', nameEn: '1.5x Points Multiplier', icon: 'trending' },
            { id: '2', nameAr: 'أولوية الحجز', nameEn: 'Priority Booking', icon: 'calendar' },
            { id: '3', nameAr: 'تسريحة مجانية شهرياً', nameEn: 'Free Monthly Styling', icon: 'gift' },
            { id: '4', nameAr: 'دوران مزدوج', nameEn: 'Double Spin', icon: 'rotate' },
          ],
          memberCount: 28,
        },
        {
          code: 'VIP',
          nameAr: 'VIP',
          nameEn: 'VIP',
          requiredLifetimeCoins: 10000,
          multiplier: 2.0,
          color: 'text-purple-400',
          gradient: 'from-purple-500/20 to-pink-600/10',
          benefits: [
            { id: '1', nameAr: 'مضاعف نقاط 2x', nameEn: '2x Points Multiplier', icon: 'trending' },
            { id: '2', nameAr: 'أولوية قصوى', nameEn: 'VIP Priority', icon: 'crown' },
            { id: '3', nameAr: 'خدمات مجانية', nameEn: 'Free Services', icon: 'gift' },
            { id: '4', nameAr: 'مكافآت حصرية', nameEn: 'Exclusive Rewards', icon: 'star' },
            { id: '5', nameAr: 'مدير حساب مخصص', nameEn: 'Dedicated Account Manager', icon: 'user' },
          ],
          memberCount: 12,
        },
      ];

      setTiers(mockTiers);
    } catch (error) {
      console.error('Failed to fetch tiers:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTiers();
  }, []);

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ar-EG').format(num);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <PageHeader
        icon={Crown}
        title="مستويات الولاء"
        description="إدارة مستويات العضوية والمزايا"
        gradient="from-yellow-500/20 to-purple-600/20"
      />

      <div className="px-4 sm:px-6 py-6 space-y-6">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {tiers.map((tier, index) => {
              const TierIcon = tierIcons[tier.code as keyof typeof tierIcons];
              const isEditing = editingTier === tier.code;

              return (
                <PremiumCard key={tier.code} className="relative overflow-hidden">
                  <div className={`absolute inset-0 bg-gradient-to-br ${tier.gradient} opacity-30`} />
                  
                  <div className="relative">
                    <div className="flex items-start justify-between mb-6">
                      <div className="flex items-center gap-4">
                        <div className={`flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br ${tier.gradient} border-2 border-zinc-700`}>
                          <TierIcon className={`h-8 w-8 ${tier.color}`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <h2 className={`text-2xl font-bold ${tier.color}`}>
                              {tier.nameAr}
                            </h2>
                            <Badge className="bg-zinc-800 text-zinc-300 border-zinc-700">
                              {tier.nameEn}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-zinc-400">
                            <div className="flex items-center gap-1">
                              <Users className="h-4 w-4" />
                              <span>{formatNumber(tier.memberCount)} عضو</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <TrendingUp className="h-4 w-4" />
                              <span>{tier.multiplier}x مضاعف</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingTier(isEditing ? null : tier.code)}
                        className={`${tier.color} hover:bg-zinc-800`}
                      >
                        {isEditing ? (
                          <>
                            <X className="w-4 h-4 ml-2" />
                            إلغاء
                          </>
                        ) : (
                          <>
                            <Edit className="w-4 h-4 ml-2" />
                            تعديل
                          </>
                        )}
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div>
                          <Label className="text-zinc-400 text-sm mb-2 block">
                            النقاط المطلوبة (مدى الحياة)
                          </Label>
                          {isEditing ? (
                            <Input
                              type="number"
                              defaultValue={tier.requiredLifetimeCoins}
                              className="bg-zinc-800 border-zinc-700"
                            />
                          ) : (
                            <p className="text-2xl font-bold text-white">
                              {formatNumber(tier.requiredLifetimeCoins)}
                            </p>
                          )}
                        </div>
                        <div>
                          <Label className="text-zinc-400 text-sm mb-2 block">
                            مضاعف النقاط
                          </Label>
                          {isEditing ? (
                            <Input
                              type="number"
                              step="0.25"
                              defaultValue={tier.multiplier}
                              className="bg-zinc-800 border-zinc-700"
                            />
                          ) : (
                            <p className="text-2xl font-bold text-yellow-400">
                              {tier.multiplier}x
                            </p>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <Label className="text-zinc-400 text-sm">المزايا</Label>
                          {isEditing && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-green-400 hover:text-green-300 hover:bg-green-400/10"
                            >
                              <Gift className="w-4 h-4 ml-1" />
                              إضافة ميزة
                            </Button>
                          )}
                        </div>
                        <div className="space-y-2">
                          {tier.benefits.map((benefit) => (
                            <div
                              key={benefit.id}
                              className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50"
                            >
                              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${tier.gradient}`}>
                                <Star className={`h-4 w-4 ${tier.color}`} />
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium text-white">
                                  {benefit.nameAr}
                                </p>
                                <p className="text-xs text-zinc-400">
                                  {benefit.nameEn}
                                </p>
                              </div>
                              {isEditing && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-red-400 hover:text-red-300 hover:bg-red-400/10"
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {isEditing && (
                      <div className="flex gap-3 mt-6 pt-6 border-t border-zinc-800">
                        <Button className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
                          <Save className="w-4 h-4 ml-2" />
                          حفظ التغييرات
                        </Button>
                        <Button
                          variant="outline"
                          className="flex-1 border-zinc-700 hover:bg-zinc-800"
                          onClick={() => setEditingTier(null)}
                        >
                          إلغاء
                        </Button>
                      </div>
                    )}

                    {index < tiers.length - 1 && (
                      <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 z-10">
                        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-zinc-900 border-2 border-zinc-800">
                          <TrendingUp className="w-5 h-5 text-yellow-500" />
                        </div>
                      </div>
                    )}
                  </div>
                </PremiumCard>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
