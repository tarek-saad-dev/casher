'use client';

import { useState, useEffect } from 'react';
import {
  Package, Gift, Plus, Edit, Percent, Coins, AlertCircle
} from 'lucide-react';
import PageHeader from '@/components/cut-club/PageHeader';
import PremiumCard from '@/components/cut-club/PremiumCard';
import { CardSkeleton } from '@/components/cut-club/LoadingSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

interface BoxReward {
  id: string;
  nameAr: string;
  nameEn: string;
  probability: number;
  coinsValue: number;
  active: boolean;
}

interface MysteryBox {
  id: number;
  nameAr: string;
  nameEn: string;
  priceCoins: number;
  rewards: BoxReward[];
  totalOpened: number;
  active: boolean;
}

export default function MysteryBoxesPage() {
  const [boxes, setBoxes] = useState<MysteryBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingBox, setEditingBox] = useState<number | null>(null);

  const fetchBoxes = async () => {
    setLoading(true);
    try {
      const mockBoxes: MysteryBox[] = [
        {
          id: 1,
          nameAr: 'صندوق المبتدئين',
          nameEn: 'Starter Box',
          priceCoins: 100,
          rewards: [
            { id: '1', nameAr: '50 نقطة', nameEn: '50 Coins', probability: 40, coinsValue: 50, active: true },
            { id: '2', nameAr: '100 نقطة', nameEn: '100 Coins', probability: 30, coinsValue: 100, active: true },
            { id: '3', nameAr: '200 نقطة', nameEn: '200 Coins', probability: 20, coinsValue: 200, active: true },
            { id: '4', nameAr: '500 نقطة', nameEn: '500 Coins', probability: 10, coinsValue: 500, active: true },
          ],
          totalOpened: 234,
          active: true,
        },
        {
          id: 2,
          nameAr: 'الصندوق المميز',
          nameEn: 'Premium Box',
          priceCoins: 500,
          rewards: [
            { id: '1', nameAr: '300 نقطة', nameEn: '300 Coins', probability: 35, coinsValue: 300, active: true },
            { id: '2', nameAr: '600 نقطة', nameEn: '600 Coins', probability: 30, coinsValue: 600, active: true },
            { id: '3', nameAr: '1000 نقطة', nameEn: '1000 Coins', probability: 25, coinsValue: 1000, active: true },
            { id: '4', nameAr: '2000 نقطة', nameEn: '2000 Coins', probability: 10, coinsValue: 2000, active: true },
          ],
          totalOpened: 89,
          active: true,
        },
        {
          id: 3,
          nameAr: 'صندوق VIP',
          nameEn: 'VIP Box',
          priceCoins: 1000,
          rewards: [
            { id: '1', nameAr: '800 نقطة', nameEn: '800 Coins', probability: 30, coinsValue: 800, active: true },
            { id: '2', nameAr: '1500 نقطة', nameEn: '1500 Coins', probability: 30, coinsValue: 1500, active: true },
            { id: '3', nameAr: '3000 نقطة', nameEn: '3000 Coins', probability: 25, coinsValue: 3000, active: true },
            { id: '4', nameAr: '5000 نقطة', nameEn: '5000 Coins', probability: 15, coinsValue: 5000, active: true },
          ],
          totalOpened: 34,
          active: true,
        },
      ];

      setBoxes(mockBoxes);
    } catch (error) {
      console.error('Failed to fetch mystery boxes:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBoxes();
  }, []);

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ar-EG').format(num);
  };

  const getTotalProbability = (rewards: BoxReward[]) => {
    return rewards.reduce((sum, reward) => sum + reward.probability, 0);
  };

  const getExpectedValue = (rewards: BoxReward[]) => {
    return rewards.reduce((sum, reward) => sum + (reward.coinsValue * reward.probability / 100), 0);
  };

  const boxGradients = [
    'from-blue-500/20 to-cyan-600/20',
    'from-purple-500/20 to-pink-600/20',
    'from-yellow-500/20 to-orange-600/20',
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <PageHeader
        icon={Package}
        title="صناديق الغموض"
        description="إدارة الصناديق واحتمالات المكافآت"
        gradient="from-pink-500/20 to-purple-600/20"
        actions={
          <Button className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
            <Plus className="w-4 h-4 ml-2" />
            صندوق جديد
          </Button>
        }
      />

      <div className="px-4 sm:px-6 py-6 space-y-6">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {boxes.map((box, index) => {
              const isEditing = editingBox === box.id;
              const totalProb = getTotalProbability(box.rewards);
              const expectedValue = getExpectedValue(box.rewards);
              const isProbabilityValid = totalProb === 100;

              return (
                <PremiumCard key={box.id} className="relative overflow-hidden">
                  <div className={`absolute inset-0 bg-gradient-to-br ${boxGradients[index % 3]} opacity-20`} />
                  
                  <div className="relative space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${boxGradients[index % 3]} border border-zinc-700`}>
                          <Gift className="h-6 w-6 text-yellow-500" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-white">{box.nameAr}</h3>
                          <p className="text-sm text-zinc-400">{box.nameEn}</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingBox(isEditing ? null : box.id)}
                        className="text-yellow-400 hover:bg-yellow-400/10"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
                      <div>
                        <p className="text-xs text-zinc-400">السعر</p>
                        <p className="text-xl font-bold text-yellow-400">
                          {formatNumber(box.priceCoins)}
                        </p>
                      </div>
                      <div className="text-left">
                        <p className="text-xs text-zinc-400">تم الفتح</p>
                        <p className="text-xl font-bold text-white">
                          {formatNumber(box.totalOpened)}
                        </p>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <Label className="text-sm text-zinc-400">المكافآت والاحتمالات</Label>
                        {!isProbabilityValid && (
                          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                            <AlertCircle className="h-3 w-3 ml-1" />
                            خطأ في النسب
                          </Badge>
                        )}
                      </div>
                      <div className="space-y-2">
                        {box.rewards.map((reward) => (
                          <div
                            key={reward.id}
                            className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700"
                          >
                            <div className="flex-1">
                              <p className="text-sm font-medium text-white">
                                {reward.nameAr}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <div className="flex items-center gap-1 text-xs text-yellow-400">
                                  <Coins className="h-3 w-3" />
                                  {formatNumber(reward.coinsValue)}
                                </div>
                                <div className="flex items-center gap-1 text-xs text-purple-400">
                                  <Percent className="h-3 w-3" />
                                  {reward.probability}%
                                </div>
                              </div>
                            </div>
                            {isEditing && (
                              <div className="flex flex-col gap-1">
                                <Input
                                  type="number"
                                  defaultValue={reward.probability}
                                  className="w-16 h-8 text-xs bg-zinc-900 border-zinc-700"
                                  placeholder="%"
                                />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-zinc-800">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-zinc-400">إجمالي الاحتمالات:</span>
                        <span className={`font-bold ${isProbabilityValid ? 'text-green-400' : 'text-red-400'}`}>
                          {totalProb}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm mt-2">
                        <span className="text-zinc-400">القيمة المتوقعة:</span>
                        <span className="font-bold text-yellow-400">
                          {formatNumber(Math.round(expectedValue))} نقطة
                        </span>
                      </div>
                    </div>

                    <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full flex">
                        {box.rewards.map((reward, idx) => (
                          <div
                            key={reward.id}
                            className={`${
                              idx === 0 ? 'bg-blue-500' :
                              idx === 1 ? 'bg-purple-500' :
                              idx === 2 ? 'bg-yellow-500' : 'bg-pink-500'
                            }`}
                            style={{ width: `${reward.probability}%` }}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
                      <div>
                        <Label className="text-sm">الحالة</Label>
                        <p className="text-xs text-zinc-400">
                          {box.active ? 'متاح للشراء' : 'غير نشط'}
                        </p>
                      </div>
                      <Switch checked={box.active} />
                    </div>

                    {isEditing && (
                      <Button className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
                        حفظ التغييرات
                      </Button>
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
