'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Crown, Users, Coins, TrendingUp, TrendingDown, RefreshCw,
  Search, Filter, Plus, Minus, RotateCcw, Eye, Loader2,
  AlertCircle, CheckCircle2, X, Calendar, Receipt,
  ChevronLeft, ChevronRight, Award, Wallet, History
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

// Simple toast implementation
const toast = {
  success: (message: string) => {
    console.log('[Toast Success]', message);
    alert(message);
  },
  error: (message: string) => {
    console.error('[Toast Error]', message);
    alert(message);
  }
};

// Types
interface LoyaltyTier {
  TierID: number;
  TierCode: string;
  TierNameAr: string;
  TierNameEn: string;
  MinLifetimePoints: number;
  PointsMultiplier: number;
}

interface LoyaltyClient {
  ClientID: number;
  ClientName: string;
  Phone: string;
  ClientLoyaltyID: number | null;
  PointsBalance: number;
  LifetimeEarnedPoints: number;
  LifetimeRedeemedPoints: number;
  LifetimeAdjustedPoints: number;
  TierID: number | null;
  TierNameAr: string | null;
  TierNameEn: string | null;
  TierCode: string | null;
  TotalVisits: number;
  TotalSpend: number;
  LastVisitDate: string | null;
  LastEarnAt: string | null;
  IsActive: boolean;
}

interface LoyaltyStats {
  totalLoyaltyClients: number;
  totalPointsBalance: number;
  totalLifetimeEarned: number;
  totalLifetimeAdjusted: number;
  totalVisits: number;
  totalSpend: number;
  bronzeCount: number;
  silverCount: number;
  goldCount: number;
  vipCount: number;
  todayEarnedPoints: number;
  todayManualAdjustments: number;
  todayReversedPoints: number;
}

interface LedgerEntry {
  LedgerID: number;
  ClientID?: number;
  ClientName?: string;
  Phone?: string;
  MovementType: 'EARN_SALE' | 'ADJUST_ADD' | 'ADJUST_SUBTRACT' | 'REVERSAL' | 'REDEEM';
  PointsDelta: number;
  PointsBefore: number;
  PointsAfter: number;
  SourceInvID: number | null;
  SourceInvType: string | null;
  InvoiceAmount: number | null;
  Notes: string | null;
  CreatedAt: string;
}

interface ClientDetail {
  client: {
    ClientID: number;
    ClientName: string;
    Phone: string;
  };
  loyalty: {
    ClientLoyaltyID: number;
    PointsBalance: number;
    LifetimeEarnedPoints: number;
    LifetimeRedeemedPoints: number;
    LifetimeAdjustedPoints: number;
    TierCode: string;
    TierNameAr: string;
    TotalVisits: number;
    TotalSpend: number;
    LastVisitDate: string | null;
    LastEarnAt: string | null;
  } | null;
  recentLedger: LedgerEntry[];
  stats: {
    totalEarnedFromSales: number;
    totalManualAdjustments: number;
    totalReversed: number;
    currentBalance: number;
  };
}

const tierColors: Record<string, { bg: string; text: string; border: string }> = {
  'BRONZE': { bg: 'bg-amber-700/20', text: 'text-amber-600', border: 'border-amber-700/30' },
  'SILVER': { bg: 'bg-slate-400/20', text: 'text-slate-400', border: 'border-slate-400/30' },
  'GOLD': { bg: 'bg-yellow-500/20', text: 'text-yellow-500', border: 'border-yellow-500/30' },
  'VIP': { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' },
};

const movementTypeLabels: Record<string, { label: string; color: string }> = {
  'EARN_SALE': { label: 'نقاط من فاتورة', color: 'text-yellow-500' },
  'ADJUST_ADD': { label: 'إضافة يدوية', color: 'text-emerald-500' },
  'ADJUST_SUBTRACT': { label: 'خصم يدوي', color: 'text-red-500' },
  'REVERSAL': { label: 'عكس نقاط', color: 'text-orange-500' },
  'REDEEM': { label: 'استبدال', color: 'text-blue-500' },
};

export default function LoyaltyPage() {
  // State
  const [stats, setStats] = useState<LoyaltyStats | null>(null);
  const [clients, setClients] = useState<LoyaltyClient[]>([]);
  const [tiers, setTiers] = useState<LoyaltyTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('clients');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Safe date format function
  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    if (mounted) {
      return new Date(dateString).toLocaleDateString('ar-EG');
    }
    return new Date(dateString).toISOString().split('T')[0];
  };

  const formatDateTime = (dateString: string) => {
    if (mounted) {
      return new Date(dateString).toLocaleString('ar-EG');
    }
    return new Date(dateString).toISOString();
  };

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTier, setSelectedTier] = useState('');
  const [hasPointsOnly, setHasPointsOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Modals state
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [reverseModalOpen, setReverseModalOpen] = useState(false);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<LoyaltyClient | null>(null);
  const [clientDetail, setClientDetail] = useState<ClientDetail | null>(null);

  // Form state
  const [adjustType, setAdjustType] = useState<'add' | 'subtract'>('add');
  const [adjustPoints, setAdjustPoints] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');
  const [reverseInvId, setReverseInvId] = useState('');
  const [reverseInvType, setReverseInvType] = useState('مبيعات');
  const [reverseNotes, setReverseNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Ledger state
  const [globalLedger, setGlobalLedger] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerTotalPages, setLedgerTotalPages] = useState(1);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/loyalty/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  // Fetch tiers
  const fetchTiers = useCallback(async () => {
    try {
      const res = await fetch('/api/loyalty/tiers');
      if (res.ok) {
        const data = await res.json();
        setTiers(data);
      }
    } catch (err) {
      console.error('Failed to fetch tiers:', err);
    }
  }, []);

  // Fetch clients
  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (selectedTier) params.set('tierCode', selectedTier);
      if (hasPointsOnly) params.set('hasPoints', 'true');
      params.set('page', currentPage.toString());
      params.set('limit', '20');

      const res = await fetch(`/api/loyalty/clients?${params}`);
      if (res.ok) {
        const data = await res.json();
        setClients(data.clients);
        setTotalPages(data.pagination.totalPages);
      } else {
        toast.error('فشل في تحميل قائمة العملاء');
      }
    } catch (err) {
      console.error('Failed to fetch clients:', err);
      toast.error('فشل في تحميل قائمة العملاء');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedTier, hasPointsOnly, currentPage]);

  // Fetch global ledger
  const fetchGlobalLedger = useCallback(async () => {
    setLedgerLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', ledgerPage.toString());
      params.set('limit', '20');

      const res = await fetch(`/api/loyalty/ledger?${params}`);
      if (res.ok) {
        const data = await res.json();
        setGlobalLedger(data.ledger);
        setLedgerTotalPages(data.pagination.totalPages);
      }
    } catch (err) {
      console.error('Failed to fetch ledger:', err);
    } finally {
      setLedgerLoading(false);
    }
  }, [ledgerPage]);

  // Fetch client detail
  const fetchClientDetail = useCallback(async (clientId: number) => {
    try {
      const res = await fetch(`/api/loyalty/client/${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setClientDetail(data);
      } else {
        toast.error('فشل في تحميل تفاصيل العميل');
      }
    } catch (err) {
      console.error('Failed to fetch client detail:', err);
      toast.error('فشل في تحميل تفاصيل العميل');
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchStats();
    fetchTiers();
  }, [fetchStats, fetchTiers]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  useEffect(() => {
    if (activeTab === 'ledger') {
      fetchGlobalLedger();
    }
  }, [activeTab, fetchGlobalLedger]);

  // Handlers
  const handleSearch = () => {
    setCurrentPage(1);
    fetchClients();
  };

  const handleReset = () => {
    setSearchQuery('');
    setSelectedTier('');
    setHasPointsOnly(false);
    setCurrentPage(1);
    fetchClients();
  };

  const openAdjustModal = (client: LoyaltyClient, type: 'add' | 'subtract') => {
    setSelectedClient(client);
    setAdjustType(type);
    setAdjustPoints('');
    setAdjustNotes('');
    setAdjustModalOpen(true);
  };

  const openDetailDrawer = async (client: LoyaltyClient) => {
    setSelectedClient(client);
    setDetailDrawerOpen(true);
    await fetchClientDetail(client.ClientID);
  };

  const handleAdjustPoints = async () => {
    if (!selectedClient) return;

    const points = parseInt(adjustPoints, 10);
    if (isNaN(points) || points <= 0) {
      toast.error('الرجاء إدخال عدد نقاط صحيح');
      return;
    }

    if (!adjustNotes.trim()) {
      toast.error('الملاحظات مطلوبة');
      return;
    }

    const pointsDelta = adjustType === 'add' ? points : -points;

    // Check if subtracting more than balance
    if (adjustType === 'subtract' && points > selectedClient.PointsBalance) {
      toast.error('رصيد النقاط غير كافٍ للخصم');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/loyalty/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClient.ClientID,
          pointsDelta,
          notes: adjustNotes.trim()
        })
      });

      if (res.ok) {
        toast.success(adjustType === 'add' 
          ? `تم إضافة ${points} نقطة بنجاح` 
          : `تم خصم ${points} نقطة بنجاح`
        );
        setAdjustModalOpen(false);
        fetchClients();
        fetchStats();
        if (detailDrawerOpen && selectedClient) {
          fetchClientDetail(selectedClient.ClientID);
        }
      } else {
        const error = await res.json();
        toast.error(error.error || 'فشل في تعديل النقاط');
      }
    } catch (err) {
      toast.error('فشل في تعديل النقاط');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReverseSale = async () => {
    const invId = parseInt(reverseInvId, 10);
    if (isNaN(invId) || invId <= 0) {
      toast.error('الرجاء إدخال رقم فاتورة صحيح');
      return;
    }

    if (!reverseNotes.trim()) {
      toast.error('الملاحظات مطلوبة');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/loyalty/reverse-sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invId,
          invType: reverseInvType,
          notes: reverseNotes.trim()
        })
      });

      if (res.ok) {
        toast.success('تم عكس نقاط الفاتورة بنجاح');
        setReverseModalOpen(false);
        setReverseInvId('');
        setReverseNotes('');
        fetchClients();
        fetchStats();
        if (activeTab === 'ledger') {
          fetchGlobalLedger();
        }
      } else {
        const error = await res.json();
        toast.error(error.error || 'فشل في عكس نقاط الفاتورة');
      }
    } catch (err) {
      toast.error('فشل في عكس نقاط الفاتورة');
    } finally {
      setSubmitting(false);
    }
  };

  const formatPoints = (points: number) => {
    return new Intl.NumberFormat('ar-EG').format(points);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP' }).format(amount);
  };

  const getTierBadge = (tierCode: string | null) => {
    if (!tierCode) {
      return (
        <Badge variant="outline" className="text-gray-500 border-gray-600">
          غير مفعل
        </Badge>
      );
    }
    
    const colors = tierColors[tierCode] || tierColors['BRONZE'];
    const tier = tiers.find(t => t.TierCode === tierCode);
    
    return (
      <Badge className={`${colors.bg} ${colors.text} ${colors.border} border`}>
        {tier?.TierNameAr || tierCode}
      </Badge>
    );
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white" dir="rtl">
      {/* Header */}
      <div className="border-b border-zinc-800 bg-[#0a0a0a]/80 backdrop-blur sticky top-0 z-10">
        <div className="px-4 sm:px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500/20 to-amber-600/20 
                              border border-yellow-500/30 flex items-center justify-center">
                  <Crown className="w-5 h-5 text-yellow-500" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-white">CUT CLUB</h1>
                  <p className="text-sm text-gray-400">إدارة نقاط العملاء والمستويات وحركات الولاء</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { fetchStats(); fetchClients(); }}
                className="border-zinc-700 hover:bg-zinc-800"
              >
                <RefreshCw className="w-4 h-4 ml-2" />
                تحديث
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReverseModalOpen(true)}
                className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
              >
                <RotateCcw className="w-4 h-4 ml-2" />
                عكس نقاط فاتورة
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="px-4 sm:px-6 py-6">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
          <KpiCard
            title="العملاء المشتركين"
            value={stats?.totalLoyaltyClients || 0}
            icon={<Users className="w-5 h-5 text-blue-400" />}
            className="bg-zinc-900/50 border-zinc-800"
          />
          <KpiCard
            title="إجمالي النقاط"
            value={formatPoints(stats?.totalPointsBalance || 0)}
            icon={<Coins className="w-5 h-5 text-yellow-400" />}
            className="bg-zinc-900/50 border-zinc-800"
          />
          <KpiCard
            title="النقاط المكتسبة"
            value={formatPoints(stats?.totalLifetimeEarned || 0)}
            icon={<TrendingUp className="w-5 h-5 text-emerald-400" />}
            className="bg-zinc-900/50 border-zinc-800"
          />
          <KpiCard
            title="التعديلات اليدوية"
            value={formatPoints(stats?.totalLifetimeAdjusted || 0)}
            icon={<TrendingDown className="w-5 h-5 text-orange-400" />}
            className="bg-zinc-900/50 border-zinc-800"
          />
          <KpiCard
            title="إجمالي الزيارات"
            value={stats?.totalVisits || 0}
            icon={<History className="w-5 h-5 text-purple-400" />}
            className="bg-zinc-900/50 border-zinc-800"
          />
          <KpiCard
            title="إجمالي الإنفاق"
            value={formatCurrency(stats?.totalSpend || 0)}
            icon={<Wallet className="w-5 h-5 text-cyan-400" />}
            className="bg-zinc-900/50 border-zinc-800"
          />
          <KpiCard
            title="نقاط اليوم"
            value={formatPoints(stats?.todayEarnedPoints || 0)}
            icon={<Award className="w-5 h-5 text-yellow-400" />}
            className="bg-zinc-900/50 border-zinc-800"
          />
          <KpiCard
            title="تعديلات اليوم"
            value={formatPoints(stats?.todayManualAdjustments || 0)}
            icon={<RefreshCw className="w-5 h-5 text-pink-400" />}
            className="bg-zinc-900/50 border-zinc-800"
          />
        </div>

        {/* Tier Distribution */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-amber-700/10 border border-amber-700/30 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-amber-600 font-semibold">BRONZE</span>
              <span className="text-2xl font-bold text-amber-500">{stats?.bronzeCount || 0}</span>
            </div>
          </div>
          <div className="bg-slate-400/10 border border-slate-400/30 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-semibold">SILVER</span>
              <span className="text-2xl font-bold text-slate-300">{stats?.silverCount || 0}</span>
            </div>
          </div>
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-yellow-500 font-semibold">GOLD</span>
              <span className="text-2xl font-bold text-yellow-400">{stats?.goldCount || 0}</span>
            </div>
          </div>
          <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-purple-400 font-semibold">VIP</span>
              <span className="text-2xl font-bold text-purple-400">{stats?.vipCount || 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-4 sm:px-6 pb-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-zinc-900 border border-zinc-800 mb-4">
            <TabsTrigger value="clients" className="data-[state=active]:bg-zinc-800">
              <Users className="w-4 h-4 ml-2" />
              العملاء
            </TabsTrigger>
            <TabsTrigger value="ledger" className="data-[state=active]:bg-zinc-800">
              <History className="w-4 h-4 ml-2" />
              سجل الحركات
            </TabsTrigger>
          </TabsList>

          <TabsContent value="clients" className="mt-0">
            {/* Search & Filters */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 mb-4">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="بحث بالاسم، رقم الهاتف، أو معرف العميل..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    className="pr-10 bg-zinc-800 border-zinc-700"
                  />
                </div>
                <Select value={selectedTier || 'ALL'} onValueChange={(v) => setSelectedTier(v === 'ALL' ? '' : v)}>
                  <SelectTrigger className="w-full md:w-40 bg-zinc-800 border-zinc-700">
                    <SelectValue placeholder="المستوى" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    <SelectItem value="ALL">الكل</SelectItem>
                    <SelectItem value="BRONZE">BRONZE</SelectItem>
                    <SelectItem value="SILVER">SILVER</SelectItem>
                    <SelectItem value="GOLD">GOLD</SelectItem>
                    <SelectItem value="VIP">VIP</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Switch
                    id="hasPoints"
                    checked={hasPointsOnly}
                    onCheckedChange={(checked: boolean) => setHasPointsOnly(checked)}
                  />
                  <label htmlFor="hasPoints" className="text-sm text-gray-400 cursor-pointer">
                    أصحاب النقاط فقط
                  </label>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSearch} className="bg-yellow-500 hover:bg-yellow-600 text-black">
                    <Filter className="w-4 h-4 ml-2" />
                    بحث
                  </Button>
                  <Button variant="outline" onClick={handleReset} className="border-zinc-700 hover:bg-zinc-800">
                    <RefreshCw className="w-4 h-4 ml-2" />
                    إعادة
                  </Button>
                </div>
              </div>
            </div>

            {/* Clients Table */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-zinc-800/50">
                    <tr>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">العميل</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">رقم الهاتف</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">المستوى</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">رصيد النقاط</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">النقاط المكتسبة</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">التعديلات</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">الزيارات</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">الإنفاق</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">آخر زيارة</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-400">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {loading ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-8 text-center">
                          <Loader2 className="w-6 h-6 animate-spin mx-auto text-yellow-500" />
                        </td>
                      </tr>
                    ) : clients.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                          لا يوجد عملاء مطابقين للبحث
                        </td>
                      </tr>
                    ) : (
                      clients.map((client) => (
                        <tr key={client.ClientID} className="hover:bg-zinc-800/30">
                          <td className="px-4 py-3">
                            <div>
                              <div className="font-medium text-white">{client.ClientName}</div>
                              <div className="text-xs text-gray-500">#{client.ClientID}</div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-300">{client.Phone || '-'}</td>
                          <td className="px-4 py-3">{getTierBadge(client.TierCode)}</td>
                          <td className="px-4 py-3">
                            <span className="font-bold text-yellow-400">
                              {formatPoints(client.PointsBalance)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-emerald-400">
                            {formatPoints(client.LifetimeEarnedPoints)}
                          </td>
                          <td className="px-4 py-3 text-sm text-orange-400">
                            {formatPoints(client.LifetimeAdjustedPoints)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-300">{client.TotalVisits}</td>
                          <td className="px-4 py-3 text-sm text-gray-300">
                            {formatCurrency(client.TotalSpend)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-400">
                            {formatDate(client.LastVisitDate)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openDetailDrawer(client)}
                                className="text-blue-400 hover:text-blue-300 hover:bg-blue-400/10"
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openAdjustModal(client, 'add')}
                                className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10"
                              >
                                <Plus className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openAdjustModal(client, 'subtract')}
                                disabled={client.PointsBalance <= 0}
                                className="text-red-400 hover:text-red-300 hover:bg-red-400/10"
                              >
                                <Minus className="w-4 h-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
                  <div className="text-sm text-gray-500">
                    صفحة {currentPage} من {totalPages}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="border-zinc-700 hover:bg-zinc-800"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="border-zinc-700 hover:bg-zinc-800"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="ledger" className="mt-0">
            {/* Global Ledger */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-zinc-800/50">
                    <tr>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">#</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">العميل</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">النوع</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">التغيير</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">قبل</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">بعد</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">الفاتورة</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">الملاحظات</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {ledgerLoading ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center">
                          <Loader2 className="w-6 h-6 animate-spin mx-auto text-yellow-500" />
                        </td>
                      </tr>
                    ) : globalLedger.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                          لا يوجد حركات مسجلة
                        </td>
                      </tr>
                    ) : (
                      globalLedger.map((entry) => {
                        const typeInfo = movementTypeLabels[entry.MovementType] || 
                          { label: entry.MovementType, color: 'text-gray-400' };
                        
                        return (
                          <tr key={entry.LedgerID} className="hover:bg-zinc-800/30">
                            <td className="px-4 py-3 text-sm text-gray-500">{entry.LedgerID}</td>
                            <td className="px-4 py-3">
                              <div>
                                <div className="font-medium text-white">{entry.ClientName}</div>
                                <div className="text-xs text-gray-500">{entry.Phone}</div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-sm ${typeInfo.color}`}>
                                {typeInfo.label}
                              </span>
                            </td>
                            <td className={`px-4 py-3 font-medium ${
                              entry.PointsDelta > 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}>
                              {entry.PointsDelta > 0 ? '+' : ''}{formatPoints(entry.PointsDelta)}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-400">
                              {formatPoints(entry.PointsBefore)}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-300">
                              {formatPoints(entry.PointsAfter)}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-400">
                              {entry.SourceInvID ? (
                                <span>{entry.SourceInvID} {entry.SourceInvType}</span>
                              ) : '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-400 max-w-xs truncate">
                              {entry.Notes || '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-400">
                              {formatDateTime(entry.CreatedAt)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {ledgerTotalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
                  <div className="text-sm text-gray-500">
                    صفحة {ledgerPage} من {ledgerTotalPages}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLedgerPage(p => Math.max(1, p - 1))}
                      disabled={ledgerPage === 1}
                      className="border-zinc-700 hover:bg-zinc-800"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLedgerPage(p => Math.min(ledgerTotalPages, p + 1))}
                      disabled={ledgerPage === ledgerTotalPages}
                      className="border-zinc-700 hover:bg-zinc-800"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Adjust Points Modal */}
      <Dialog open={adjustModalOpen} onOpenChange={setAdjustModalOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {adjustType === 'add' ? (
                <>
                  <Plus className="w-5 h-5 text-emerald-400" />
                  إضافة نقاط
                </>
              ) : (
                <>
                  <Minus className="w-5 h-5 text-red-400" />
                  خصم نقاط
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {selectedClient && (
            <div className="space-y-4">
              <div className="bg-zinc-800/50 rounded-lg p-4">
                <div className="text-sm text-gray-400">العميل</div>
                <div className="font-medium">{selectedClient.ClientName}</div>
                <div className="text-xs text-gray-500">#{selectedClient.ClientID}</div>
              </div>
              
              <div className="bg-zinc-800/50 rounded-lg p-4">
                <div className="text-sm text-gray-400">الرصيد الحالي</div>
                <div className="text-2xl font-bold text-yellow-400">
                  {formatPoints(selectedClient.PointsBalance)} نقطة
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm text-gray-400">نوع العملية</label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={adjustType === 'add' ? 'default' : 'outline'}
                    onClick={() => setAdjustType('add')}
                    className={adjustType === 'add' ? 'bg-emerald-600 hover:bg-emerald-700' : 'border-zinc-700'}
                  >
                    <Plus className="w-4 h-4 ml-2" />
                    إضافة
                  </Button>
                  <Button
                    type="button"
                    variant={adjustType === 'subtract' ? 'default' : 'outline'}
                    onClick={() => setAdjustType('subtract')}
                    className={adjustType === 'subtract' ? 'bg-red-600 hover:bg-red-700' : 'border-zinc-700'}
                  >
                    <Minus className="w-4 h-4 ml-2" />
                    خصم
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm text-gray-400">عدد النقاط</label>
                <Input
                  type="number"
                  min="1"
                  value={adjustPoints}
                  onChange={(e) => setAdjustPoints(e.target.value)}
                  placeholder="أدخل عدد النقاط..."
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm text-gray-400">الملاحظات / السبب</label>
                <Input
                  value={adjustNotes}
                  onChange={(e) => setAdjustNotes(e.target.value)}
                  placeholder="أدخل سبب التعديل..."
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>

              {adjustType === 'subtract' && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 mt-0.5" />
                  <p className="text-sm text-red-400">
                    سيتم خصم {adjustPoints || 0} نقطة من رصيد العميل. 
                    تأكد من صحة العملية قبل التنفيذ.
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={handleAdjustPoints}
                  disabled={submitting || !adjustPoints || !adjustNotes}
                  className={adjustType === 'add' 
                    ? 'bg-emerald-600 hover:bg-emerald-700 flex-1' 
                    : 'bg-red-600 hover:bg-red-700 flex-1'
                  }
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      {adjustType === 'add' ? <Plus className="w-4 h-4 ml-2" /> : <Minus className="w-4 h-4 ml-2" />}
                      تنفيذ
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setAdjustModalOpen(false)}
                  className="border-zinc-700 hover:bg-zinc-800"
                >
                  إلغاء
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reverse Sale Modal */}
      <Dialog open={reverseModalOpen} onOpenChange={setReverseModalOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-400">
              <RotateCcw className="w-5 h-5" />
              عكس نقاط فاتورة
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              هذا الإجراء سيخصم النقاط التي تمت إضافتها من هذه الفاتورة إن وجدت
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-gray-400">رقم الفاتورة</label>
              <Input
                type="number"
                value={reverseInvId}
                onChange={(e) => setReverseInvId(e.target.value)}
                placeholder="أدخل رقم الفاتورة..."
                className="bg-zinc-800 border-zinc-700"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm text-gray-400">نوع الفاتورة</label>
              <Select value={reverseInvType} onValueChange={setReverseInvType}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  <SelectItem value="مبيعات">مبيعات</SelectItem>
                  <SelectItem value="مرتجع">مرتجع</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-gray-400">الملاحظات</label>
              <Input
                value={reverseNotes}
                onChange={(e) => setReverseNotes(e.target.value)}
                placeholder="أدخل سبب عكس النقاط..."
                className="bg-zinc-800 border-zinc-700"
              />
            </div>

            <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-orange-400 mt-0.5" />
              <p className="text-sm text-orange-400">
                تنبيه: هذا الإجراء لا يمكن التراجع عنه. سيتم تسجيل العملية في سجل الحركات.
                لن يكرر الخصم إذا تم تنفيذه سابقاً.
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleReverseSale}
                disabled={submitting || !reverseInvId || !reverseNotes}
                className="bg-orange-600 hover:bg-orange-700 flex-1"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4 ml-2" />
                    عكس النقاط
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setReverseModalOpen(false)}
                className="border-zinc-700 hover:bg-zinc-800"
              >
                إلغاء
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Client Detail Drawer */}
      <Dialog open={detailDrawerOpen} onOpenChange={setDetailDrawerOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserDetailsIcon className="w-5 h-5 text-blue-400" />
              تفاصيل العميل
            </DialogTitle>
          </DialogHeader>
          {selectedClient && clientDetail ? (
            <div className="space-y-6">
              {/* Client Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-800/50 rounded-lg p-4">
                  <div className="text-sm text-gray-400">الاسم</div>
                  <div className="font-medium text-lg">{clientDetail.client.ClientName}</div>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-4">
                  <div className="text-sm text-gray-400">رقم الهاتف</div>
                  <div className="font-medium">{clientDetail.client.Phone || '-'}</div>
                </div>
              </div>

              {/* Loyalty Info */}
              {clientDetail.loyalty ? (
                <div className="bg-gradient-to-br from-yellow-500/10 to-amber-600/10 border border-yellow-500/20 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Crown className="w-5 h-5 text-yellow-500" />
                      <span className="font-semibold text-yellow-500">CUT CLUB</span>
                    </div>
                    {getTierBadge(clientDetail.loyalty.TierCode)}
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-sm text-gray-400">رصيد النقاط</div>
                      <div className="text-2xl font-bold text-yellow-400">
                        {formatPoints(clientDetail.loyalty.PointsBalance)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400">النقاط المكتسبة</div>
                      <div className="text-xl font-bold text-emerald-400">
                        {formatPoints(clientDetail.loyalty.LifetimeEarnedPoints)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400">التعديلات</div>
                      <div className="text-xl font-bold text-orange-400">
                        {formatPoints(clientDetail.loyalty.LifetimeAdjustedPoints)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-zinc-700/50">
                    <div>
                      <div className="text-sm text-gray-400">عدد الزيارات</div>
                      <div className="font-medium">{clientDetail.loyalty.TotalVisits}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400">إجمالي الإنفاق</div>
                      <div className="font-medium">{formatCurrency(clientDetail.loyalty.TotalSpend)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400">آخر زيارة</div>
                      <div className="font-medium">
                        {formatDate(clientDetail.loyalty.LastVisitDate)}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-zinc-800/50 rounded-lg p-8 text-center">
                  <div className="text-gray-400 mb-2">العميل ليس مشتركاً في CUT CLUB</div>
                  <p className="text-sm text-gray-500">
                    سيتم إنشاء حساب ولاء تلقائياً عند أول فاتورة أو أول تعديل يدوي
                  </p>
                </div>
              )}

              {/* Recent Ledger */}
              {clientDetail.recentLedger.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-3">آخر الحركات</h4>
                  <div className="bg-zinc-800/30 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-800/50">
                        <tr>
                          <th className="px-3 py-2 text-right text-xs text-gray-500">النوع</th>
                          <th className="px-3 py-2 text-right text-xs text-gray-500">التغيير</th>
                          <th className="px-3 py-2 text-right text-xs text-gray-500">الرصيد</th>
                          <th className="px-3 py-2 text-right text-xs text-gray-500">التاريخ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800">
                        {clientDetail.recentLedger.slice(0, 5).map((entry) => {
                          const typeInfo = movementTypeLabels[entry.MovementType] || 
                            { label: entry.MovementType, color: 'text-gray-400' };
                          
                          return (
                            <tr key={entry.LedgerID}>
                              <td className={`px-3 py-2 ${typeInfo.color}`}>
                                {typeInfo.label}
                              </td>
                              <td className={`px-3 py-2 font-medium ${
                                entry.PointsDelta > 0 ? 'text-emerald-400' : 'text-red-400'
                              }`}>
                                {entry.PointsDelta > 0 ? '+' : ''}{formatPoints(entry.PointsDelta)}
                              </td>
                              <td className="px-3 py-2 text-gray-400">
                                {formatPoints(entry.PointsAfter)}
                              </td>
                              <td className="px-3 py-2 text-gray-500 text-xs">
                                {formatDate(entry.CreatedAt)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    setDetailDrawerOpen(false);
                    openAdjustModal(selectedClient, 'add');
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 flex-1"
                >
                  <Plus className="w-4 h-4 ml-2" />
                  إضافة نقاط
                </Button>
                <Button
                  onClick={() => {
                    setDetailDrawerOpen(false);
                    openAdjustModal(selectedClient, 'subtract');
                  }}
                  disabled={!clientDetail.loyalty || clientDetail.loyalty.PointsBalance <= 0}
                  className="bg-red-600 hover:bg-red-700 flex-1"
                >
                  <Minus className="w-4 h-4 ml-2" />
                  خصم نقاط
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-yellow-500" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Helper icon component
function UserDetailsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}
