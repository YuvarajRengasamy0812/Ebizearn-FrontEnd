import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  Megaphone,
  ShieldCheck,
  Receipt,
  FileCheck,
  AlertCircle,
  Loader2,
  ArrowRight,
  Activity,
  DollarSign,
  TrendingUp,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { adminApi, getApiError } from '../../api';
import type { AdminDashboardMetrics, RevenueChartPoint } from '../../types';
import { EmptyState } from '../../components/common/EmptyState';
import { StatCard, SectionHeader } from '../../components/common/StatCard';
import { useMoney } from '../../hooks/useMoney';

/**
 * Admin overview. Every number comes from GET /admin/dashboard. There are no
 * GMV charts, no fabricated event streams, and no demo fallbacks — when the
 * API has no data, the queues simply show as empty.
 */
export const AdminOverviewPage: React.FC = () => {
  const [metrics, setMetrics] = useState<AdminDashboardMetrics | null>(null);
  const [verificationQueue, setVerificationQueue] = useState<unknown[]>([]);
  const [fraudAlerts, setFraudAlerts] = useState<unknown[]>([]);
  const [recentUsers, setRecentUsers] = useState<Array<{ id: number; name: string; email: string; role: string; created_at: string }>>([]);
  const [revenueChart, setRevenueChart] = useState<RevenueChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { fmt } = useMoney();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dash = await adminApi.dashboard();
      if (dash.success) {
        setMetrics(dash.data.metrics);
        setVerificationQueue((dash.data.verification_queue || []).slice(0, 5));
        setFraudAlerts((dash.data.recent_fraud || []).slice(0, 5));
        setRecentUsers(dash.data.recent_users || []);
        setRevenueChart(dash.data.revenue_chart || []);
      }
    } catch (e) {
      setError(getApiError(e, 'Could not load admin dashboard.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500 dark:text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading overview…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-500/10 border-2 border-red-200 dark:border-red-500/30 rounded-[1.5rem] p-6 flex items-start gap-3">
        <AlertCircle className="w-6 h-6 text-red-500 dark:text-red-300 mt-0.5 shrink-0" />
        <div className="text-sm">
          <p className="font-bold text-red-700 dark:text-red-300">Could not load admin dashboard</p>
          <p className="text-red-600 dark:text-red-400 mt-1">{error}</p>
          <button type="button" onClick={() => void load()} className="mt-2 text-sm font-bold text-red-700 dark:text-red-300 underline min-h-[44px]">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const queueActions = [
    {
      to: '/admin/verification',
      label: 'Verification queue',
      count: metrics?.pending_verification ?? 0,
      desc: 'Submissions awaiting review',
      gradient: 'from-amber-500 to-orange-600',
      shadow: 'shadow-amber-500/25',
      icon: FileCheck,
    },
    {
      to: '/admin/withdrawals',
      label: 'Withdrawal queue',
      count: metrics?.pending_payouts ?? 0,
      desc: 'Payouts awaiting approval',
      gradient: 'from-[#7257FF] to-[#9D7BFF]',
      shadow: 'shadow-violet-500/25',
      icon: Receipt,
    },
    {
      to: '/admin/fraud',
      label: 'Fraud alerts',
      count: metrics?.fraud_alerts_count ?? 0,
      desc: 'Open risk signals',
      gradient: 'from-red-500 to-rose-600',
      shadow: 'shadow-red-500/25',
      icon: ShieldCheck,
    },
  ];

  return (
    <div className="space-y-8 text-left">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-[1.75rem] bg-navy-gradient p-6 sm:p-8 text-white">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-[#168BFF]/30 blur-3xl" />
        <div className="absolute -bottom-28 left-1/3 w-72 h-72 rounded-full bg-[#7257FF]/25 blur-3xl" />
        <div className="relative">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-[#20C4E8]">
            <Activity className="w-3.5 h-3.5" /> Platform command center
          </p>
          <h1 className="mt-2 text-2xl sm:text-[2rem] font-black tracking-tight">Admin Overview</h1>
          <p className="mt-1.5 text-sm sm:text-base text-slate-300">
            Live platform state — every figure is served by the API.
          </p>
        </div>
      </div>

      {/* Metric cards — every card links to the page behind its number. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard to="/admin/users?role=contributor" label="Total contributors" value={String(metrics?.total_contributors ?? '—')} icon={Users} gradient="from-[#168BFF] to-[#20C4E8]" shadow="shadow-lg shadow-blue-500/25" />
        <StatCard to="/admin/businesses" label="Businesses" value={String(metrics?.total_businesses ?? '—')} icon={Megaphone} gradient="from-emerald-500 to-teal-600" shadow="shadow-lg shadow-emerald-500/25" />
        <StatCard to="/admin/campaigns" label="Active campaigns" value={String(metrics?.active_campaigns ?? '—')} icon={Activity} gradient="from-violet-500 to-purple-600" shadow="shadow-lg shadow-violet-500/25" />
        <StatCard to="/admin/fraud" label="Open fraud alerts" value={String(metrics?.fraud_alerts_count ?? '—')} icon={ShieldCheck} gradient="from-red-500 to-rose-600" shadow="shadow-lg shadow-red-500/25" />
      </div>

      {/* Revenue */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard to="/admin/reports" label="Total revenue (fees)" value={fmt(metrics?.total_revenue_cents ?? 0)} icon={DollarSign} gradient="from-amber-500 to-orange-600" shadow="shadow-lg shadow-amber-500/25" />
        <StatCard to="/admin/reports" label="Today's revenue" value={fmt(metrics?.today_revenue_cents ?? 0)} icon={TrendingUp} gradient="from-emerald-500 to-teal-600" shadow="shadow-lg shadow-emerald-500/25" />
        <StatCard to="/admin/deposits" label="Pending deposits" value={String(metrics?.pending_deposits ?? '—')} icon={Wallet} gradient="from-[#7257FF] to-[#9D7BFF]" shadow="shadow-lg shadow-violet-500/25" />
        <StatCard to="/admin/withdrawals" label="Pending payouts" value={String(metrics?.pending_payouts ?? '—')} icon={Receipt} gradient="from-sky-500 to-blue-600" shadow="shadow-lg shadow-sky-500/25" />
      </div>

      {/* Revenue chart */}
      {revenueChart.length > 0 && (
        <div className="bg-white dark:bg-[#0C1322] rounded-[1.5rem] border border-[#E7ECF3] dark:border-white/10 card-shadow p-6">
          <SectionHeader title="Revenue — last 7 days" subtitle="Platform fees collected" />
          <div className="flex items-end gap-2 h-32 mt-4">
            {revenueChart.map((p) => {
              const max = Math.max(...revenueChart.map((x) => x.revenue_cents), 1);
              const h = Math.max(4, Math.round((p.revenue_cents / max) * 100));
              return (
                <div key={p.day} className="flex-1 flex flex-col items-center gap-1.5">
                  <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400">${(p.revenue_cents / 100).toFixed(0)}</span>
                  <div className="w-full rounded-lg bg-gradient-to-t from-[#168BFF] to-[#20C4E8]" style={{ height: `${h}%`, minHeight: 4 }} title={`${p.day}: $${(p.revenue_cents / 100).toFixed(2)}`} />
                  <span className="text-[10px] text-gray-400">{p.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Queue quick actions */}
      <div>
        <SectionHeader title="Needs your attention" subtitle="The three operational queues, live." />
        <div className="grid sm:grid-cols-3 gap-4">
          {queueActions.map((a) => {
            const Icon = a.icon;
            return (
              <Link
                key={a.to}
                to={a.to}
                className="group bg-[#0E1C2F] hover:bg-[#16293f] text-white rounded-[1.5rem] p-6 transition-all hover:-translate-y-0.5 hover:shadow-xl"
              >
                <div className="flex items-start justify-between">
                  <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${a.gradient} shadow-lg ${a.shadow} flex items-center justify-center`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <ArrowRight className="w-5 h-5 text-slate-500 dark:text-gray-400 group-hover:text-white group-hover:translate-x-1 transition-all" />
                </div>
                <p className="mt-4 text-3xl font-black tracking-tight">{a.count}</p>
                <p className="text-sm font-bold text-white mt-1">{a.label}</p>
                <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">{a.desc}</p>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Real queues preview */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-[#0C1322] rounded-[1.5rem] border border-[#E7ECF3] dark:border-white/10 card-shadow p-6">
          <SectionHeader title="Latest verification items" actionLabel="Open queue" actionTo="/admin/verification" />
          {verificationQueue.length === 0 ? (
            <EmptyState icon={FileCheck} title="Queue is clear" description="No submissions waiting for review right now." />
          ) : (
            <div className="space-y-2">
              {(verificationQueue as { id: number; task?: { title?: string }; user?: { name?: string }; created_at: string }[]).map((s) => (
                <div key={s.id} className="flex items-center justify-between px-4 py-3 bg-[#F8FAFD] dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-2xl">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-gray-100 truncate">{s.task?.title || `Submission #${s.id}`}</p>
                    <p className="text-xs text-slate-400 dark:text-gray-500">{s.user?.name || ''} · {new Date(s.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-[#0C1322] rounded-[1.5rem] border border-[#E7ECF3] dark:border-white/10 card-shadow p-6">
          <SectionHeader title="Latest fraud alerts" actionLabel="Open alerts" actionTo="/admin/fraud" />
          {fraudAlerts.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No open alerts" description="The fraud service has not raised any alerts." />
          ) : (
            <div className="space-y-2">
              {(fraudAlerts as { id: number; risk_level?: string; reason?: string; created_at?: string }[]).map((a) => (
                <div key={a.id} className="flex items-center justify-between px-4 py-3 bg-[#F8FAFD] dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-2xl">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-gray-100 truncate">{a.reason || `Alert #${a.id}`}</p>
                    <p className="text-xs text-slate-400 dark:text-gray-500">
                      {a.risk_level ? `Risk: ${a.risk_level}` : ''} {a.created_at ? `· ${new Date(a.created_at).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* Recent signups */}
      <div className="bg-white dark:bg-[#0C1322] rounded-[1.5rem] border border-[#E7ECF3] dark:border-white/10 card-shadow p-6">
        <SectionHeader title="Newest members" subtitle="Latest signups across all roles" />
        {recentUsers.length === 0 ? (
          <EmptyState icon={UserPlus} title="No signups yet" description="New users will appear here." />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {recentUsers.map((u) => (
              <div key={u.id} className="px-4 py-3 bg-[#F8FAFD] dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-2xl">
                <p className="text-sm font-bold text-slate-900 dark:text-gray-100 truncate">{u.name}</p>
                <p className="text-xs text-slate-400 truncate">{u.email}</p>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300">{u.role}</span>
                  <span className="text-[10px] text-gray-400">{new Date(u.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
