import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Pencil, Save, Sparkles, X, XCircle } from 'lucide-react';
import { adminApi, getApiError } from '../../api';
import { useAuth } from '../../context/AuthContext';
import type { Campaign } from '../../types';
import { PostImagePicker } from '../campaign/PostImagePicker';

type Mode = 'none' | 'manual' | 'auto';

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};

/**
 * Staff review of the post text contributors copy: see it, approve or
 * reject it (tasks are hidden until approved), or override the mode / text
 * (staff-written text is approved on save).
 */
export const CampaignContentPanel: React.FC<{ campaign: Campaign; onChanged: (c: Campaign) => void }> = ({ campaign, onChanged }) => {
  const { user } = useAuth();
  const canEdit = user?.role === 'superadmin' || !!user?.permissions?.includes('edit_campaigns');

  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<Mode>(campaign.content_mode ?? 'none');
  const [text, setText] = useState(campaign.generated_content ?? '');
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  /** Staff image change (approved by them): replace or remove. */
  const changeImage = async (fn: () => Promise<{ data: { content_image_url: string | null; content_status: string | null } }>) => {
    setImageBusy(true);
    setImageError(null);
    try {
      const res = await fn();
      onChanged({
        ...campaign,
        content_image_url: res.data.content_image_url,
        content_status: (res.data.content_status as Campaign['content_status']) ?? campaign.content_status,
      });
    } catch (e) {
      setImageError(getApiError(e, 'Could not update the image.'));
    } finally {
      setImageBusy(false);
    }
  };
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setMode(campaign.content_mode ?? 'none');
    setText(campaign.generated_content ?? '');
  }, [campaign.content_mode, campaign.generated_content]);

  const run = async (fn: () => Promise<{ success: boolean; message?: string; data: Campaign }>) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fn();
      if (res.success) {
        onChanged(res.data);
        setMsg({ ok: true, text: res.message || 'Saved.' });
        setEditing(false);
        setRejecting(false);
        setNote('');
      }
    } catch (e) {
      setMsg({ ok: false, text: getApiError(e, 'Could not save.') });
    } finally {
      setBusy(false);
    }
  };

  const status = campaign.content_status;

  return (
    <div className="rounded-2xl border-2 border-violet-200 dark:border-violet-500/25 bg-violet-500/5 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> Post content for contributors
        </p>
        <div className="flex items-center gap-2">
          {campaign.content_mode && (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white dark:bg-white/10 text-gray-700 dark:text-gray-200">
              {campaign.content_mode === 'auto' ? 'Auto — own version per contributor' : 'Manual — same text for all'}
            </span>
          )}
          {status && (
            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold capitalize ${STATUS_STYLE[status] ?? ''}`}>
              {status === 'pending' ? 'Waiting for approval' : status}
            </span>
          )}
          {canEdit && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-200 dark:border-white/10 text-[11px] font-bold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-white/10"
            >
              <Pencil className="w-3 h-3" /> Change
            </button>
          )}
        </div>
      </div>

      {!editing ? (
        <>
          {/* Post image — always shown, not only with post text. The image
              is the creative itself; image-only campaigns need it too. */}
          {canEdit ? (
            <PostImagePicker
              currentUrl={campaign.content_image_url}
              file={null}
              busy={imageBusy}
              error={imageError}
              onFile={(f) => {
                if (f) void changeImage(() => adminApi.uploadCampaignContentImage(campaign.id, f));
              }}
              onRemoveCurrent={() => void changeImage(() => adminApi.removeCampaignContentImage(campaign.id))}
            />
          ) : campaign.content_image_url ? (
            <img src={campaign.content_image_url} alt="Post image" className="w-full max-h-72 object-contain rounded-xl bg-white dark:bg-white/5" />
          ) : null}
          {campaign.content_mode ? (
            <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words bg-white dark:bg-white/5 rounded-xl p-3">
              {campaign.generated_content}
            </p>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">No post text — contributors follow the instructions only.</p>
          )}
          {status === 'pending' && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">Contributors can't see this campaign's tasks until the content is approved.</p>
          )}
          {status === 'rejected' && campaign.content_review_note && (
            <p className="text-[11px] text-red-600 dark:text-red-400">Rejected: {campaign.content_review_note}</p>
          )}

          {campaign.content_mode && status !== 'approved' && (
            rejecting ? (
              <div className="space-y-2">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="What should the business change?"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-xs text-gray-900 dark:text-gray-100"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy || !note.trim()}
                    onClick={() => void run(() => adminApi.campaignContentDecision(campaign.id, 'reject', note.trim()))}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold disabled:opacity-40"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Reject content
                  </button>
                  <button type="button" onClick={() => setRejecting(false)} className="px-3 py-1.5 rounded-lg text-xs font-bold text-gray-500">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => adminApi.campaignContentDecision(campaign.id, 'approve'))}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-40"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Approve content
                </button>
                {status !== 'rejected' && (
                  <button
                    type="button"
                    onClick={() => setRejecting(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 text-xs font-bold"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Reject
                  </button>
                )}
              </div>
            )
          )}
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(['none', 'manual', 'auto'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 ${
                  mode === m ? 'border-violet-500 text-violet-700 dark:text-violet-300 bg-white dark:bg-violet-500/10' : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300'
                }`}
              >
                {m === 'none' ? 'No post text' : m === 'manual' ? 'Manual' : 'Auto (AI)'}
              </button>
            ))}
          </div>
          {mode !== 'none' && (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder={mode === 'auto' ? 'Approved base text — each contributor gets their own rewording of it' : 'Text every contributor copies'}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-gray-900 dark:text-gray-100"
            />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || (mode !== 'none' && !text.trim())}
              onClick={() =>
                void run(() =>
                  adminApi.updateCampaignContent(campaign.id, {
                    content_mode: mode === 'none' ? null : mode,
                    ...(mode !== 'none' ? { generated_content: text.trim() } : {}),
                  }),
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#168BFF] hover:bg-[#0f7ae5] text-white text-xs font-bold disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save & approve
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setMode(campaign.content_mode ?? 'none');
                setText(campaign.generated_content ?? '');
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-gray-500"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
          </div>
          <p className="text-[10px] text-gray-500 dark:text-gray-400">Offensive or inappropriate words are blocked automatically.</p>
        </div>
      )}

      {msg && (
        <p className={`text-xs font-semibold flex items-center gap-1.5 ${msg.ok ? 'text-emerald-600' : 'text-red-600 dark:text-red-400'}`}>
          {msg.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />} {msg.text}
        </p>
      )}
    </div>
  );
};
