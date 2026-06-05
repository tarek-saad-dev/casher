'use client';

import { useState } from 'react';
import {
  Settings as SettingsIcon, Coins, Store, UserPlus, Package,
  Crown, AlertTriangle, Trash2, Power
} from 'lucide-react';
import PageHeader from '@/components/cut-club/PageHeader';
import PremiumCard from '@/components/cut-club/PremiumCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';

export default function SettingsPage() {
  const [coinSettings, setCoinSettings] = useState({
    pointsPerCurrency: 1,
    coinMultiplier: 1.0,
    expiryEnabled: false,
    expiryDays: 365,
  });

  const [storeSettings, setStoreSettings] = useState({
    enabled: true,
    minPurchaseInterval: 0,
    maxPurchasesPerDay: 0,
  });

  const [referralSettings, setReferralSettings] = useState({
    enabled: true,
    rewardCoins: 200,
    requireFirstVisit: true,
  });

  const [mysteryBoxSettings, setMysteryBoxSettings] = useState({
    enabled: true,
    dailyLimit: 3,
  });

  const [tierSettings, setTierSettings] = useState({
    autoUpgrade: true,
    notifyOnUpgrade: true,
  });

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <PageHeader
        icon={SettingsIcon}
        title="إعدادات CUT CLUB"
        description="تكوين قواعد وإعدادات اقتصاد الولاء"
        gradient="from-zinc-500/20 to-slate-600/20"
      />

      <div className="px-4 sm:px-6 py-6 space-y-6">
        <PremiumCard>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <Coins className="h-5 w-5 text-yellow-500" />
            </div>
            <h2 className="text-lg font-bold text-white">إعدادات النقاط</h2>
          </div>

          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>النقاط لكل جنيه</Label>
                <Input
                  type="number"
                  value={coinSettings.pointsPerCurrency}
                  onChange={(e) =>
                    setCoinSettings({
                      ...coinSettings,
                      pointsPerCurrency: parseFloat(e.target.value),
                    })
                  }
                  className="bg-zinc-800 border-zinc-700"
                />
                <p className="text-xs text-zinc-500">
                  عدد النقاط التي يكسبها العميل لكل جنيه ينفقه
                </p>
              </div>

              <div className="space-y-2">
                <Label>مضاعف النقاط الأساسي</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={coinSettings.coinMultiplier}
                  onChange={(e) =>
                    setCoinSettings({
                      ...coinSettings,
                      coinMultiplier: parseFloat(e.target.value),
                    })
                  }
                  className="bg-zinc-800 border-zinc-700"
                />
                <p className="text-xs text-zinc-500">
                  مضاعف عام يطبق على جميع النقاط المكتسبة
                </p>
              </div>
            </div>

            <Separator className="bg-zinc-800" />

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
                <div className="flex-1">
                  <Label>تفعيل انتهاء صلاحية النقاط</Label>
                  <p className="text-xs text-zinc-400 mt-1">
                    النقاط غير المستخدمة ستنتهي صلاحيتها بعد فترة محددة
                  </p>
                </div>
                <Switch
                  checked={coinSettings.expiryEnabled}
                  onCheckedChange={(checked) =>
                    setCoinSettings({ ...coinSettings, expiryEnabled: checked })
                  }
                />
              </div>

              {coinSettings.expiryEnabled && (
                <div className="space-y-2 pr-4">
                  <Label>مدة الصلاحية (أيام)</Label>
                  <Input
                    type="number"
                    value={coinSettings.expiryDays}
                    onChange={(e) =>
                      setCoinSettings({
                        ...coinSettings,
                        expiryDays: parseInt(e.target.value),
                      })
                    }
                    className="bg-zinc-800 border-zinc-700"
                  />
                </div>
              )}
            </div>
          </div>
        </PremiumCard>

        <PremiumCard>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 border border-blue-500/30">
              <Store className="h-5 w-5 text-blue-500" />
            </div>
            <h2 className="text-lg font-bold text-white">إعدادات المتجر</h2>
          </div>

          <div className="space-y-6">
            <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
              <div className="flex-1">
                <Label>تفعيل المتجر</Label>
                <p className="text-xs text-zinc-400 mt-1">
                  السماح للعملاء بشراء المكافآت من المتجر
                </p>
              </div>
              <Switch
                checked={storeSettings.enabled}
                onCheckedChange={(checked) =>
                  setStoreSettings({ ...storeSettings, enabled: checked })
                }
              />
            </div>

            {storeSettings.enabled && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>الحد الأدنى للفترة بين المشتريات (دقائق)</Label>
                  <Input
                    type="number"
                    value={storeSettings.minPurchaseInterval}
                    onChange={(e) =>
                      setStoreSettings({
                        ...storeSettings,
                        minPurchaseInterval: parseInt(e.target.value),
                      })
                    }
                    className="bg-zinc-800 border-zinc-700"
                  />
                  <p className="text-xs text-zinc-500">0 = بدون حد</p>
                </div>

                <div className="space-y-2">
                  <Label>الحد الأقصى للمشتريات يومياً</Label>
                  <Input
                    type="number"
                    value={storeSettings.maxPurchasesPerDay}
                    onChange={(e) =>
                      setStoreSettings({
                        ...storeSettings,
                        maxPurchasesPerDay: parseInt(e.target.value),
                      })
                    }
                    className="bg-zinc-800 border-zinc-700"
                  />
                  <p className="text-xs text-zinc-500">0 = بدون حد</p>
                </div>
              </div>
            )}
          </div>
        </PremiumCard>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <PremiumCard>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10 border border-green-500/30">
                <UserPlus className="h-5 w-5 text-green-500" />
              </div>
              <h2 className="text-lg font-bold text-white">إعدادات الإحالة</h2>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
                <div className="flex-1">
                  <Label>تفعيل الإحالات</Label>
                  <p className="text-xs text-zinc-400 mt-1">
                    السماح للعملاء بدعوة أصدقاء
                  </p>
                </div>
                <Switch
                  checked={referralSettings.enabled}
                  onCheckedChange={(checked) =>
                    setReferralSettings({ ...referralSettings, enabled: checked })
                  }
                />
              </div>

              {referralSettings.enabled && (
                <>
                  <div className="space-y-2">
                    <Label>مكافأة الإحالة (نقاط)</Label>
                    <Input
                      type="number"
                      value={referralSettings.rewardCoins}
                      onChange={(e) =>
                        setReferralSettings({
                          ...referralSettings,
                          rewardCoins: parseInt(e.target.value),
                        })
                      }
                      className="bg-zinc-800 border-zinc-700"
                    />
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
                    <div className="flex-1">
                      <Label>يتطلب زيارة أولى</Label>
                      <p className="text-xs text-zinc-400 mt-1">
                        المكافأة تُمنح بعد الزيارة الأولى للمُحال
                      </p>
                    </div>
                    <Switch
                      checked={referralSettings.requireFirstVisit}
                      onCheckedChange={(checked) =>
                        setReferralSettings({
                          ...referralSettings,
                          requireFirstVisit: checked,
                        })
                      }
                    />
                  </div>
                </>
              )}
            </div>
          </PremiumCard>

          <PremiumCard>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10 border border-purple-500/30">
                <Package className="h-5 w-5 text-purple-500" />
              </div>
              <h2 className="text-lg font-bold text-white">إعدادات صناديق الغموض</h2>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
                <div className="flex-1">
                  <Label>تفعيل صناديق الغموض</Label>
                  <p className="text-xs text-zinc-400 mt-1">
                    السماح للعملاء بفتح صناديق الغموض
                  </p>
                </div>
                <Switch
                  checked={mysteryBoxSettings.enabled}
                  onCheckedChange={(checked) =>
                    setMysteryBoxSettings({ ...mysteryBoxSettings, enabled: checked })
                  }
                />
              </div>

              {mysteryBoxSettings.enabled && (
                <div className="space-y-2">
                  <Label>الحد اليومي للصناديق</Label>
                  <Input
                    type="number"
                    value={mysteryBoxSettings.dailyLimit}
                    onChange={(e) =>
                      setMysteryBoxSettings({
                        ...mysteryBoxSettings,
                        dailyLimit: parseInt(e.target.value),
                      })
                    }
                    className="bg-zinc-800 border-zinc-700"
                  />
                  <p className="text-xs text-zinc-500">
                    عدد الصناديق التي يمكن فتحها يومياً
                  </p>
                </div>
              )}
            </div>
          </PremiumCard>
        </div>

        <PremiumCard>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-pink-500/10 border border-pink-500/30">
              <Crown className="h-5 w-5 text-pink-500" />
            </div>
            <h2 className="text-lg font-bold text-white">إعدادات المستويات</h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
              <div className="flex-1">
                <Label>الترقية التلقائية</Label>
                <p className="text-xs text-zinc-400 mt-1">
                  ترقية العملاء تلقائياً عند الوصول للنقاط المطلوبة
                </p>
              </div>
              <Switch
                checked={tierSettings.autoUpgrade}
                onCheckedChange={(checked) =>
                  setTierSettings({ ...tierSettings, autoUpgrade: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
              <div className="flex-1">
                <Label>إشعار الترقية</Label>
                <p className="text-xs text-zinc-400 mt-1">
                  إرسال إشعار للعميل عند الترقية
                </p>
              </div>
              <Switch
                checked={tierSettings.notifyOnUpgrade}
                onCheckedChange={(checked) =>
                  setTierSettings({ ...tierSettings, notifyOnUpgrade: checked })
                }
              />
            </div>
          </div>
        </PremiumCard>

        <PremiumCard className="border-red-500/20">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10 border border-red-500/30">
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-red-400">منطقة الخطر</h2>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 rounded-lg bg-red-500/5 border border-red-500/20">
              <div className="flex-1">
                <Label className="text-red-400">إعادة تعيين الاقتصاد</Label>
                <p className="text-xs text-zinc-400 mt-1">
                  حذف جميع النقاط والمعاملات (لا يمكن التراجع)
                </p>
              </div>
              <Button
                variant="outline"
                className="border-red-500/30 text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="w-4 h-4 ml-2" />
                إعادة تعيين
              </Button>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-red-500/5 border border-red-500/20">
              <div className="flex-1">
                <Label className="text-red-400">تعطيل المتجر</Label>
                <p className="text-xs text-zinc-400 mt-1">
                  إيقاف جميع عمليات الشراء من المتجر
                </p>
              </div>
              <Button
                variant="outline"
                className="border-red-500/30 text-red-400 hover:bg-red-500/10"
              >
                <Power className="w-4 h-4 ml-2" />
                تعطيل
              </Button>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-red-500/5 border border-red-500/20">
              <div className="flex-1">
                <Label className="text-red-400">تعطيل الإحالات</Label>
                <p className="text-xs text-zinc-400 mt-1">
                  إيقاف نظام الإحالات بالكامل
                </p>
              </div>
              <Button
                variant="outline"
                className="border-red-500/30 text-red-400 hover:bg-red-500/10"
              >
                <Power className="w-4 h-4 ml-2" />
                تعطيل
              </Button>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-red-500/5 border border-red-500/20">
              <div className="flex-1">
                <Label className="text-red-400">تعطيل صناديق الغموض</Label>
                <p className="text-xs text-zinc-400 mt-1">
                  إيقاف جميع صناديق الغموض
                </p>
              </div>
              <Button
                variant="outline"
                className="border-red-500/30 text-red-400 hover:bg-red-500/10"
              >
                <Power className="w-4 h-4 ml-2" />
                تعطيل
              </Button>
            </div>
          </div>
        </PremiumCard>

        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            className="border-zinc-700 hover:bg-zinc-800"
          >
            إلغاء
          </Button>
          <Button className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
            حفظ جميع الإعدادات
          </Button>
        </div>
      </div>
    </div>
  );
}
