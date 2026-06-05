'use client';

import { useState, useEffect } from 'react';
import {
  Package, Gift, Plus, Edit, Percent, Coins, AlertCircle, Loader2, Trash2
} from 'lucide-react';
import PageHeader from '@/components/cut-club/PageHeader';
import PremiumCard from '@/components/cut-club/PremiumCard';
import EmptyState from '@/components/cut-club/EmptyState';
import { CardSkeleton } from '@/components/cut-club/LoadingSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog';

interface ApiReward {
  rewardId: number;
  boxItemId: number;
  rewardType: string;
  rewardValue: number;
  probabilityWeight: number;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
}

interface MysteryBox {
  itemId: number;
  code: string;
  nameAr: string;
  nameEn: string;
  priceCoins: number;
  totalOpened: number;
  isActive: boolean;
  rewards: ApiReward[];
}

export default function MysteryBoxesPage() {
  const [boxes, setBoxes] = useState<MysteryBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    code: '',
    nameAr: '',
    nameEn: '',
    priceCoins: 0,
    isActive: true,
    rewards: [] as { nameAr: string; nameEn: string; probabilityWeight: number; rewardValue: number }[],
  });

  const fetchBoxes = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/store/mystery-boxes');
      const data = await res.json();
      if (data.ok) setBoxes(data.boxes || []);
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

  const getTotalProbability = (rewards: ApiReward[]) => {
    return rewards.reduce((sum, r) => sum + (r.probabilityWeight || 0), 0);
  };

  const getExpectedValue = (rewards: ApiReward[]) => {
    return rewards.reduce((sum, r) => sum + ((r.rewardValue || 0) * (r.probabilityWeight || 0) / 100), 0);
  };

  const boxGradients = [
    'from-blue-500/20 to-cyan-600/20',
    'from-purple-500/20 to-pink-600/20',
    'from-yellow-500/20 to-orange-600/20',
  ];

  const openNewModal = () => {
    setFormData({
      code: '',
      nameAr: '',
      nameEn: '',
      priceCoins: 0,
      isActive: true,
      rewards: [
        { nameAr: '50 نقطة', nameEn: '50 Coins', probabilityWeight: 40, rewardValue: 50 },
        { nameAr: '100 نقطة', nameEn: '100 Coins', probabilityWeight: 30, rewardValue: 100 },
        { nameAr: '200 نقطة', nameEn: '200 Coins', probabilityWeight: 20, rewardValue: 200 },
        { nameAr: '500 نقطة', nameEn: '500 Coins', probabilityWeight: 10, rewardValue: 500 },
      ],
    });
    setError('');
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/store/mystery-boxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (data.ok) {
        setModalOpen(false);
        fetchBoxes();
      } else {
        setError(data.error || 'فشل الإنشاء');
      }
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (box: MysteryBox) => {
    try {
      const res = await fetch(`/api/admin/store/mystery-boxes/${box.itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !box.isActive }),
      });
      const data = await res.json();
      if (data.ok) fetchBoxes();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (box: MysteryBox) => {
    if (!confirm('هل أنت متأكد من حذف هذا الصندوق؟')) return;
    try {
      const res = await fetch(`/api/admin/store/mystery-boxes/${box.itemId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) fetchBoxes();
    } catch (e) {
      console.error(e);
    }
  };

  const updateReward = (index: number, field: string, value: string | number) => {
    const newRewards = [...formData.rewards];
    newRewards[index] = { ...newRewards[index], [field]: value };
    setFormData({ ...formData, rewards: newRewards });
  };

  const addReward = () => {
    setFormData({
      ...formData,
      rewards: [...formData.rewards, { nameAr: '', nameEn: '', probabilityWeight: 0, rewardValue: 0 }],
    });
  };

  const removeReward = (index: number) => {
    setFormData({
      ...formData,
      rewards: formData.rewards.filter((_, i) => i !== index),
    });
  };

  const totalFormProb = formData.rewards.reduce((s, r) => s + (Number(r.probabilityWeight) || 0), 0);
  const isFormProbValid = totalFormProb === 100;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <PageHeader
        icon={Package}
        title="صناديق الغموض"
        description="إدارة الصناديق واحتمالات المكافآت"
        gradient="from-pink-500/20 to-purple-600/20"
        actions={
          <Button onClick={openNewModal} className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
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
        ) : boxes.length === 0 ? (
          <EmptyState
            icon={Gift}
            title="لا توجد صناديق"
            description="لم يتم إنشاء أي صناديق غموض بعد"
            actionLabel="إنشاء صندوق جديد"
            onAction={openNewModal}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {boxes.map((box, index) => {
              const totalProb = getTotalProbability(box.rewards);
              const expectedValue = getExpectedValue(box.rewards);
              const isProbabilityValid = Math.round(totalProb) === 100;

              return (
                <PremiumCard key={box.itemId} className="relative overflow-hidden">
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
                          <p className="text-xs text-zinc-500">{box.code}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-yellow-400 hover:bg-yellow-400/10"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(box)}
                          className="text-red-400 hover:bg-red-400/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
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
                            key={reward.rewardId}
                            className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700"
                          >
                            <div className="flex-1">
                              <p className="text-sm font-medium text-white">
                                {reward.nameAr}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <div className="flex items-center gap-1 text-xs text-yellow-400">
                                  <Coins className="h-3 w-3" />
                                  {formatNumber(reward.rewardValue)}
                                </div>
                                <div className="flex items-center gap-1 text-xs text-purple-400">
                                  <Percent className="h-3 w-3" />
                                  {reward.probabilityWeight}%
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-zinc-800">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-zinc-400">إجمالي الاحتمالات:</span>
                        <span className={`font-bold ${isProbabilityValid ? 'text-green-400' : 'text-red-400'}`}>
                          {Math.round(totalProb)}%
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
                            key={reward.rewardId}
                            className={`${
                              idx === 0 ? 'bg-blue-500' :
                              idx === 1 ? 'bg-purple-500' :
                              idx === 2 ? 'bg-yellow-500' : 'bg-pink-500'
                            }`}
                            style={{ width: `${reward.probabilityWeight}%` }}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
                      <div>
                        <Label className="text-sm">الحالة</Label>
                        <p className="text-xs text-zinc-400">
                          {box.isActive ? 'متاح للشراء' : 'غير نشط'}
                        </p>
                      </div>
                      <Switch checked={box.isActive} onCheckedChange={() => toggleActive(box)} />
                    </div>
                  </div>
                </PremiumCard>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">صندوق غموض جديد</DialogTitle>
            <DialogDescription className="text-zinc-400">
              إنشاء صندوق غموض جديد مع احتمالات المكافآت
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
                <Input value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} placeholder="BOX-001" className="bg-zinc-800 border-zinc-700" />
              </div>
              <div className="space-y-2">
                <Label>السعر (نقاط)</Label>
                <Input type="number" value={formData.priceCoins} onChange={(e) => setFormData({ ...formData, priceCoins: parseFloat(e.target.value) || 0 })} placeholder="100" className="bg-zinc-800 border-zinc-700" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>الاسم بالعربية</Label>
                <Input value={formData.nameAr} onChange={(e) => setFormData({ ...formData, nameAr: e.target.value })} placeholder="صندوق المبتدئين" className="bg-zinc-800 border-zinc-700" />
              </div>
              <div className="space-y-2">
                <Label>الاسم بالإنجليزية</Label>
                <Input value={formData.nameEn} onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })} placeholder="Starter Box" className="bg-zinc-800 border-zinc-700" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>المكافآت</Label>
                <span className={`text-xs font-bold ${isFormProbValid ? 'text-green-400' : 'text-red-400'}`}>
                  المجموع: {totalFormProb}%
                </span>
              </div>
              <div className="space-y-2">
                {formData.rewards.map((reward, idx) => (
                  <div key={idx} className="grid grid-cols-5 gap-2 items-end">
                    <div className="col-span-2">
                      <Input value={reward.nameAr} onChange={(e) => updateReward(idx, 'nameAr', e.target.value)} placeholder="الاسم" className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                    <div>
                      <Input type="number" value={reward.rewardValue} onChange={(e) => updateReward(idx, 'rewardValue', parseFloat(e.target.value) || 0)} placeholder="القيمة" className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                    <div>
                      <Input type="number" value={reward.probabilityWeight} onChange={(e) => updateReward(idx, 'probabilityWeight', parseFloat(e.target.value) || 0)} placeholder="%" className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => removeReward(idx)} className="text-red-400 hover:bg-red-400/10 h-10">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={addReward} className="w-full border-zinc-700 hover:bg-zinc-800 text-zinc-400">
                <Plus className="w-4 h-4 ml-2" />
                إضافة مكافأة
              </Button>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
              <div>
                <Label>نشط</Label>
                <p className="text-xs text-zinc-400">متاح للشراء</p>
              </div>
              <Switch checked={formData.isActive} onCheckedChange={(v) => setFormData({ ...formData, isActive: v })} />
            </div>

            <div className="flex gap-3 pt-2">
              <Button onClick={handleSave} disabled={saving || !isFormProbValid} className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
                {saving ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
                إنشاء الصندوق
              </Button>
              <Button variant="outline" className="flex-1 border-zinc-700 hover:bg-zinc-800" onClick={() => setModalOpen(false)}>
                إلغاء
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
