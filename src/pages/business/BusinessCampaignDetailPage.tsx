import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Megaphone,
  AlertCircle,
  Play,
  Pause,
  Download,
  Loader2,
  CheckSquare,
} from 'lucide-react';
import { businessApi, getApiError } from '../../api';
import type { Campaign, Task, TaskSubmission } from '../../types';
import { useMoney } from '../../hooks/useMoney';
import { FxNote } from '../../components/common/Money';
import { EmptyState } from '../../components/common/EmptyState';
import { CreatedBy } from '../../components/common/CreatedBy';
import { PostImagePicker } from '../../components/campaign/PostImagePicker';

export const BusinessCampaignDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { fmt } = useMoney();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [submissions, setSubmissions] = useState<TaskSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  /** Attach / replace the post image on a live campaign (uploads at once). */
  const handleImageFile = async (f: File | null) => {
    setImageFile(f);
    if (!f || !campaign) return;
    setImageBusy(true);
    setImageError(null);
    try {
      const res = await businessApi.uploadContentImage(campaign.id, f);
      if (res.success) {
        setCampaign({ ...campaign, content_image_url: res.data?.content_image_url ?? null });
        setImageFile(null);
      } else {
        setImageError(res.message || 'Image could not be uploaded.');
      }
    } catch (e) {
      setImageError(getApiError(e, 'Image could not be uploaded.'));
    } finally {
      setImageBusy(false);
    }
  };

  const handleRemoveImage = async () => {
    if (!campaign) return;
    setImageBusy(true);
    setImageError(null);
    try {
      await businessApi.removeContentImage(campaign.id);
      setCampaign({ ...campaign, content_image_url: null });
    } catch (e) {
      setImageError(getApiError(e, 'Image could not be removed.'));
    } finally {
      setImageBusy(false);
    }
  };

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await businessApi.campaign(Number(id));
      // Backend shape (source of truth): data = { campaign, submissions }.
      // Submissions ride along as a Laravel paginator — no second request needed.
      if (res.success && res.data?.campaign) {
        const payload = res.data;
        setCampaign(payload.campaign as Campaign);
        const pager = payload.submissions;
        setSubmissions(Array.isArray(pager) ? pager : (pager?.data ?? []));
      } else {
        setError(res.message || 'Campaign not found.');
      }
    } catch (e) {
      setError(getApiError(e, 'Could not load campaign.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = async () => {
    if (!campaign || toggling) return;
    const next = campaign.status === 'active' ? 'paused' : 'active';
    setToggling(true);
    setActionError(null);
    try {
      const res = await businessApi.updateCampaignStatus(campaign.id, next);
      if (res.success && res.data) {
        setCampaign(res.data as Campaign);
      } else {
        setActionError(res.message || 'Could not update campaign status.');
      }
    } catch (e) {
      setActionError(getApiError(e, 'Could not update campaign status.'));
    } finally {
      setToggling(false);
    }
  };

  const handleExportCsv = useCallback(() => {
    const rows = submissions.map((s) => [
      s.id,
      s.task?.title ?? '',
      s.user?.name ?? '',
      String(s.status),
      new Date(s.created_at).toISOString(),
    ]);
    const csv = ['id,task,contributor,status,submitted_at', ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `campaign-${id}-submissions.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [submissions, id]);

  const verifiedCount = useMemo(
    () => submissions.filter((s) => s.status === 'approved').length,
    [submissions],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 dark:text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading campaign…
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Link to="/business/campaigns" className="inline-flex items-center gap-2 text-xs font-bold text-[#168BFF]">
          <ArrowLeft className="w-4 h-4" /> Back to campaigns
        </Link>
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-bold text-red-700 dark:text-red-300">Could not load campaign</p>
            <p className="text-red-600 dark:text-red-400 mt-1">{error || 'Campaign not found.'}</p>
            <button type="button" onClick={() => void load()} className="mt-2 text-xs font-bold text-red-700 dark:text-red-300 underline">
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const status = campaign.status;
  const canToggle = status === 'active' || status === 'paused';
  const spent = Math.max(0, (campaign.total_budget_cents ?? 0) - (campaign.remaining_budget_cents ?? 0));

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <Link to="/business/campaigns" className="inline-flex items-center gap-2 text-xs font-bold text-[#168BFF]">
        <ArrowLeft className="w-4 h-4" /> Back to campaigns
      </Link>

      {/* Header */}
      <div className="bg-white dark:bg-[#0C1322] rounded-2xl border border-[#E7ECF3] dark:border-white/10 shadow-xs p-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300">
              {status}
            </span>
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-gray-100 tracking-tight">{campaign.title}</h1>
          <CreatedBy creator={campaign.creator} className="mt-1" />
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-2xl">{campaign.description}</p>
          {campaign.content_mode && (
            <div className="mt-3 rounded-xl border border-violet-200 dark:border-violet-500/25 bg-violet-500/5 p-3 max-w-2xl">
              <p className="text-[11px] font-bold text-gray-700 dark:text-gray-200">
                Post content ({campaign.content_mode === 'auto' ? 'Auto — each contributor gets their own version' : 'Manual — same text for everyone'}) ·{' '}
                <span
                  className={
                    campaign.content_status === 'approved'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : campaign.content_status === 'rejected'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-amber-600 dark:text-amber-400'
                  }
                >
                  {campaign.content_status === 'approved'
                    ? 'Approved'
                    : campaign.content_status === 'rejected'
                      ? 'Rejected'
                      : 'Waiting for our team to approve — tasks go live after approval'}
                </span>
              </p>
              {campaign.content_status === 'rejected' && campaign.content_review_note && (
                <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">Reason: {campaign.content_review_note}. Contact support to update the text.</p>
              )}
              {campaign.generated_content && (
                <p className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap mt-1.5">{campaign.generated_content}</p>
              )}
            </div>
          )}
          {/* Post image — always available, not only with post text. This is
              the creative contributors download and post; without it the
              task page shows "No image attached". */}
          <div className="mt-3 rounded-xl border border-violet-200 dark:border-violet-500/25 bg-violet-500/5 p-3 max-w-2xl">
            <p className="text-xs font-bold text-gray-700 dark:text-gray-200">Post image</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 mb-2">
              Contributors download this image and post it. It shows on the task page with a download button.
            </p>
            <PostImagePicker
              currentUrl={campaign.content_image_url}
              file={imageFile}
              onFile={(f) => void handleImageFile(f)}
              onRemoveCurrent={() => void handleRemoveImage()}
              busy={imageBusy}
              error={imageError}
            />
          </div>
          {campaign.instructions_markdown && (
            <details className="mt-3 text-xs text-gray-600 dark:text-gray-400">
              <summary className="font-bold cursor-pointer text-[#168BFF]">Contributor instructions</summary>
              <p className="mt-2 whitespace-pre-wrap leading-relaxed">{campaign.instructions_markdown}</p>
            </details>
          )}
          {(campaign.media?.length ?? 0) > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
                Photos & videos for contributors ({campaign.media!.length})
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 max-w-2xl">
                {campaign.media!.map((m) =>
                  m.type === 'video' ? (
                    <video key={m.id} src={m.url} controls preload="metadata" className="aspect-square w-full rounded-xl bg-black object-cover" />
                  ) : (
                    <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer" className="aspect-square rounded-xl overflow-hidden bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10">
                      <img src={m.url} alt={m.original_name ?? 'Campaign photo'} loading="lazy" className="w-full h-full object-cover" />
                    </a>
                  ),
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canToggle && (
            <button
              type="button"
              disabled={toggling}
              onClick={() => void handleToggle()}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 ${
                status === 'active'
                  ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-500/25'
                  : 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-500/25'
              }`}
            >
              {status === 'active' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {toggling ? 'Updating…' : status === 'active' ? 'Pause' : 'Resume'}
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-4 py-3 text-xs font-bold text-red-700 dark:text-red-300">
          {actionError}
        </div>
      )}

      {/* Stats — real values from the API only */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Reward / task', value: fmt(campaign.reward_per_task_cents) },
          { label: 'Completed', value: `${campaign.completed_contributors_count ?? 0} / ${campaign.target_contributors_count ?? 0}` },
          { label: 'Total budget', value: fmt(campaign.total_budget_cents) },
          { label: 'Spent', value: fmt(spent) },
        ].map((s) => (
          <div key={s.label} className="bg-white dark:bg-[#0C1322] rounded-2xl border border-[#E7ECF3] dark:border-white/10 shadow-xs p-4">
            <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{s.label}</p>
            <p className="text-xl font-extrabold text-gray-900 dark:text-gray-100 mt-1">{s.value}</p>
          </div>
        ))}
      </div>
      <FxNote className="mt-1" />

      {/* Submissions */}
      <div className="bg-white dark:bg-[#0C1322] rounded-2xl border border-[#E7ECF3] dark:border-white/10 shadow-xs p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-emerald-600" /> Submissions ({submissions.length})
            <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500">· {verifiedCount} verified</span>
          </h3>
          {submissions.length > 0 && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gray-100 dark:bg-white/10 hover:bg-gray-200 text-xs font-bold text-gray-700 dark:text-gray-300 transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          )}
        </div>

        {submissions.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title="No submissions yet"
            description="Proof submitted by contributors for this campaign will appear here."
          />
        ) : (
          <div className="glass rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-white/10">
                  <th className="py-2 pr-4 font-bold">Contributor</th>
                  <th className="py-2 pr-4 font-bold">Task</th>
                  <th className="py-2 pr-4 font-bold">Status</th>
                  <th className="py-2 pr-4 font-bold">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-3 pr-4 font-bold text-gray-900 dark:text-gray-100">{s.user?.name || '—'}</td>
                    <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{s.task?.title || `Task #${s.task_id}`}</td>
                    <td className="py-3 pr-4">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300">
                        {String(s.status).replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-gray-500 dark:text-gray-400 text-xs">{new Date(s.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {campaign.tasks && campaign.tasks.length > 0 && (
        <div className="bg-white dark:bg-[#0C1322] rounded-2xl border border-[#E7ECF3] dark:border-white/10 shadow-xs p-6">
          <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
            <Megaphone className="w-4 h-4 text-[#168BFF]" /> Tasks in this campaign
          </h3>
          <div className="space-y-2">
            {campaign.tasks.map((t: Task) => (
              <div
                key={t.id}
                className="flex items-center justify-between px-4 py-3 bg-[#F7F9FC] dark:bg-[#0B0F19] border border-[#E7ECF3] dark:border-white/10 rounded-xl"
              >
                <p className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate min-w-0 flex-1 mr-2">{t.title}</p>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400">
                  {String(t.status)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
