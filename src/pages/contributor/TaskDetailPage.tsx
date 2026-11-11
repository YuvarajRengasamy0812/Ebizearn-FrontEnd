import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Clock,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Upload,
  Link as LinkIcon,
  ExternalLink,
  Sparkles,
  Copy,
  Check,
  X,
  FileCheck,
  Loader2,
} from 'lucide-react';
import { tasksApi, getApiError } from '../../api';
import { mapTaskForUi } from '../../utils/apiMappers';
import { compressScreenshot } from '../../utils/compressImage';
import { useMoney } from '../../hooks/useMoney';
import type { UiTask, TaskSubmission } from '../../types';
import { PlatformPreview } from '../../components/task/PlatformPreview';
import { TaskAssetActions } from '../../components/task/TaskAssetActions';
import { CampaignMediaGallery } from '../../components/task/CampaignMediaGallery';
import { VerificationTimeline } from '../../components/task/VerificationTimeline';
import { humanizeRetention, initials, proofRequirementLabels } from '../../components/task/TaskCard';
import { EmptyState } from '../../components/common/EmptyState';
import { useRequireVerifiedEmail } from '../../components/auth/EmailVerification';
import { ReadyToPostCard } from '../../components/task/ReadyToPostCard';
import { PostImagePlaceholder } from '../../components/campaign/PostImagePicker';

/**
 * Phase 5 — split-screen task execution.
 * LEFT: platform preview mockup (driven by task platform/type from the API).
 * RIGHT: contributor action panel (start task, upload screenshot, proof URL,
 * submit → real submission endpoint, then the live verification status flow).
 */
export const TaskDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { fmt } = useMoney();
  const { requireVerified, gate } = useRequireVerifiedEmail();
  const [task, setTask] = useState<UiTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Execution state
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Proof form
  const [proofUrl, setProofUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotName, setScreenshotName] = useState<string | null>(null);
  const [preparingScreenshot, setPreparingScreenshot] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<TaskSubmission | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    tasksApi
      .get(id)
      .then((res) => {
        if (res.success && res.data) {
          const mapped = mapTaskForUi(res.data);
          setTask(mapped);
          // Pre-fill the proof link with the task's target URL — the
          // contributor submits the SAME link they visited, for AI verification.
          if (mapped.targetUrl) setProofUrl(mapped.targetUrl);
          setLoadError(null);
        } else {
          setLoadError('Task not found or no longer available.');
        }
      })
      .catch((err) => setLoadError(getApiError(err, 'Could not load this task.')))
      .finally(() => setLoading(false));

    // Check whether the contributor already submitted for this task.
    tasksApi
      .myTasks()
      .then((res) => {
        if (res.success && res.data) {
          const mine = res.data.find((s) => String(s.task_id) === String(id) || s.task?.uuid === id);
          if (mine) {
            setSubmission(mine);
            setStarted(true);
          }
        }
      })
      .catch(() => undefined);
  }, [id]);

  // Post text for this contributor — fetched once the task is reserved.
  const [postContent, setPostContent] = useState<{ loading: boolean; text: string | null; imageUrl: string | null; personal: boolean; error: string | null }>({
    loading: false,
    text: null,
    imageUrl: null,
    personal: false,
    error: null,
  });
  const taskKey = task ? task.uuid || task.id : null;
  const hasPostContent = !!task?.hasPostContent;
  useEffect(() => {
    if (!started || !hasPostContent || !taskKey) return;
    let alive = true;
    setPostContent((p) => ({ ...p, loading: true, error: null }));
    tasksApi
      .content(taskKey)
      .then((res) => {
        if (!alive) return;
        setPostContent({ loading: false, text: res.data?.content ?? null, imageUrl: res.data?.image_url ?? null, personal: !!res.data?.personal, error: null });
      })
      .catch((err) => alive && setPostContent({ loading: false, text: null, imageUrl: null, personal: false, error: getApiError(err, 'Could not load the post text.') }));
    return () => {
      alive = false;
    };
  }, [started, hasPostContent, taskKey]);

  const handleStart = async () => {
    if (!task) return;
    setStarting(true);
    setStartError(null);
    try {
      const res = await tasksApi.start(task.uuid || task.id);
      if (res.success !== false) {
        setStarted(true);
      } else {
        setStartError(res.message || 'Could not reserve this task right now.');
      }
    } catch (err) {
      setStartError(getApiError(err, 'Could not reserve this task right now.'));
    } finally {
      setStarting(false);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setSubmitError('Screenshot must be under 8 MB.');
      return;
    }
    setSubmitError(null);
    setPreparingScreenshot(true);
    try {
      // Shrink the screenshot in the browser first: the server rejects
      // request bodies over ~1 MB (Apache 413), and the 413 carries no
      // CORS headers, so the browser reports it as "Can't reach the
      // server". A raw phone screenshot is routinely 1–5 MB.
      const dataUrl = await compressScreenshot(file);
      if (dataUrl.length > 950_000) {
        setSubmitError('That screenshot is still too large to send — please crop it to just the post and try again.');
        return;
      }
      setScreenshot(dataUrl);
      setScreenshotName(file.name);
    } catch {
      // Compression failed (unreadable image) — fall back to the raw file
      // so the user can still try; the server may reject it if too large.
      const reader = new FileReader();
      reader.onload = () => {
        setScreenshot(reader.result as string);
        setScreenshotName(file.name);
      };
      reader.readAsDataURL(file);
    } finally {
      setPreparingScreenshot(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Proof submission is a money-moving action — verified email required.
    if (!requireVerified()) return;
    if (!task) return;
    setSubmitError(null);

    const url = proofUrl.trim();
    // Screenshot is REQUIRED — AI verification needs visual proof.
    if (!screenshot) {
      setSubmitError('A screenshot is required. Take a screenshot of your completed action and upload it.');
      return;
    }
    if (!url) {
      setSubmitError('The proof link is required — it should be the same link from the task above.');
      return;
    }
    if (url && !/^https?:\/\//i.test(url)) {
      setSubmitError('Proof URL must start with http:// or https://');
      return;
    }

    setSubmitting(true);
    try {
      const res = await tasksApi.submit(task.uuid || task.id, {
        proof_url: url || undefined,
        proof_screenshot: screenshot,
        note: note.trim() || undefined,
      });
      if (res.success) {
        const fresh: TaskSubmission = {
          id: res.data?.submission?.id || Date.now(),
          uuid: res.data?.submission?.uuid || '',
          task_id: task.id,
          user_id: 0,
          status: 'under_review',
          proof_data_json: { url, note: note.trim() || undefined },
          created_at: new Date().toISOString(),
        };
        setSubmission(fresh);
        // Refresh real status from the API to show the true verification stage.
        tasksApi
          .myTasks()
          .then((r) => {
            const mine = r.data?.find((s) => String(s.task_id) === String(task.id) || s.task?.uuid === task.uuid);
            if (mine) setSubmission(mine);
          })
          .catch(() => undefined);
      } else {
        setSubmitError(res.message || 'Submission failed. Please try again.');
      }
    } catch (err) {
      setSubmitError(getApiError(err, 'Submission failed. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-[#0C1322] rounded-3xl border border-[#E7ECF3] dark:border-white/10 h-96 animate-pulse" />
        <div className="bg-white dark:bg-[#0C1322] rounded-3xl border border-[#E7ECF3] dark:border-white/10 h-96 animate-pulse" />
      </div>
    );
  }

  if (loadError || !task) {
    return (
      <div className="max-w-2xl mx-auto">
        <EmptyState
          title="Task unavailable"
          description={loadError || 'This task could not be loaded. It may have been paused or completed.'}
          icon={AlertCircle}
          actionLabel="Back to available tasks"
          onAction={() => (window.location.href = '/app/tasks')}
        />
      </div>
    );
  }

  const requirements = proofRequirementLabels(task.campaign?.proof_requirements_json);

  return (
    <div className="max-w-6xl mx-auto space-y-5 text-left">
      {gate}
      <div className="flex items-center justify-between">
        <Link to="/app/tasks" className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to tasks
        </Link>
        <span className="text-[11px] font-mono text-gray-400 dark:text-gray-500">#{task.uuid?.slice(0, 8) || task.id}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* LEFT — platform preview + task facts */}
        <div className="space-y-5 min-w-0">
          <PlatformPreview task={task} />

          {/* Download creative → copy caption → open platform → post → submit proof */}
          <TaskAssetActions task={task} imageUrl={postContent.imageUrl || task.postImageUrl || task.flyerUrl} />

          <CampaignMediaGallery media={task.campaign?.media ?? []} taskKey={String(task.uuid || task.id)} />

          <div className="bg-white dark:bg-[#0C1322] rounded-3xl border border-[#E7ECF3] dark:border-white/10 p-5 sm:p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[#07182F] text-white flex items-center justify-center text-sm font-black shrink-0">
                {initials(task.brandName)}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400">{task.brandName}</p>
                <h1 className="text-lg sm:text-xl font-black text-gray-900 dark:text-gray-100 leading-snug">{task.title}</h1>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10">
                <p className="text-[10px] font-bold uppercase text-gray-400 dark:text-gray-500">Reward</p>
                <p className="text-sm font-black text-[#16B364] mt-0.5">{fmt(task.reward_cents)}</p>
              </div>
              <div className="p-3 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10">
                <p className="text-[10px] font-bold uppercase text-gray-400 dark:text-gray-500">Est. time</p>
                <p className="text-sm font-black text-gray-900 dark:text-gray-100 mt-0.5 inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" /> {task.estimated_minutes} min
                </p>
              </div>
              <div className="p-3 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10">
                <p className="text-[10px] font-bold uppercase text-gray-400 dark:text-gray-500">Platform</p>
                <p className="text-sm font-black text-gray-900 dark:text-gray-100 mt-0.5">{task.platform}</p>
              </div>
              <div className="p-3 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10">
                <p className="text-[10px] font-bold uppercase text-gray-400 dark:text-gray-500">Type</p>
                <p className="text-sm font-black text-gray-900 dark:text-gray-100 mt-0.5 capitalize">{task.categoryName}</p>
              </div>
            </div>

            {task.description && task.description !== task.title && (
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{task.description}</p>
            )}

            {requirements.length > 0 && (
              <div>
                <p className="text-[11px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">Requirements</p>
                <ul className="space-y-1.5">
                  {requirements.map((req) => (
                    <li key={req} className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#16B364] shrink-0 mt-px" />
                      <span className="capitalize">{req}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-start gap-2 p-3 rounded-2xl bg-amber-50/70 dark:bg-amber-500/15 border border-amber-200/60 dark:border-amber-500/30">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-px" />
              <p className="text-[11px] text-amber-800 dark:text-amber-200 leading-snug">
                <span className="font-black">Retention rule:</span> reversing this action before the{' '}
                {humanizeRetention(task.retentionHours)} period ends can reverse this reward.
              </p>
            </div>
          </div>
        </div>

        {/* RIGHT — action panel */}
        <div className="lg:sticky lg:top-6 space-y-5 min-w-0">
          <div className="bg-white dark:bg-[#0C1322] rounded-3xl border border-[#E7ECF3] dark:border-white/10 p-5 sm:p-6 shadow-xs">
            {submission ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 flex items-center justify-center">
                    <FileCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-black text-gray-900 dark:text-gray-100">Proof submitted</h2>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Track your verification below — it's updated from the platform.</p>
                  </div>
                </div>
                <div className="pt-1">
                  <VerificationTimeline status={submission.status} aiResult={submission.aiResult} />
                </div>
                {submission.review_notes && (
                  <div className="p-3 bg-amber-50 dark:bg-amber-500/15 rounded-xl border border-amber-200 dark:border-amber-500/30 text-xs">
                    <span className="text-amber-800 dark:text-amber-200 font-bold block mb-0.5">Reviewer note</span>
                    <p className="text-amber-900">{submission.review_notes}</p>
                  </div>
                )}
                <Link
                  to="/app/my-tasks"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-[#168BFF] hover:underline"
                >
                  View all my tasks <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ) : !started ? (
              <div className="space-y-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-500/10 text-[#168BFF] flex items-center justify-center mx-auto">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-base font-black text-gray-900 dark:text-gray-100">Ready to complete this task?</h2>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                    Reserve a slot first. Then complete the real action on {task.platform} (see the preview for guidance),
                    and submit your proof here.
                  </p>
                </div>
                {startError && (
                  <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-xl text-left" role="alert">{startError}</div>
                )}
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={starting}
                  className="w-full py-3.5 bg-[#168BFF] hover:bg-[#2F80FF] text-white rounded-2xl font-black text-sm transition-all shadow-lg shadow-[#168BFF]/25 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  <span>{starting ? 'Reserving…' : 'Start task — reserve my slot'}</span>
                </button>
                {task.targetUrl && (
                  <div className="bg-gradient-to-br from-[#168BFF]/10 to-[#168BFF]/5 border-2 border-[#168BFF]/30 rounded-2xl p-4 space-y-3">
                    <p className="text-xs font-black uppercase tracking-wider text-[#168BFF]">How to complete this task</p>
                    <ol className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                      <li className="flex items-start gap-2">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-[#168BFF] text-white text-[11px] font-black flex items-center justify-center">1</span>
                        <span>Tap the button below to open the link</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-[#168BFF] text-white text-[11px] font-black flex items-center justify-center">2</span>
                        <span>Complete the action (follow, like, subscribe…)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-[#168BFF] text-white text-[11px] font-black flex items-center justify-center">3</span>
                        <span>Take a screenshot as proof</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-[#168BFF] text-white text-[11px] font-black flex items-center justify-center">4</span>
                        <span>Upload it below and submit</span>
                      </li>
                    </ol>
                    <a
                      href={task.targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-3.5 rounded-2xl font-black text-sm bg-[#168BFF] hover:bg-[#2F80FF] text-white transition-all shadow-lg shadow-[#168BFF]/25 flex items-center justify-center gap-2"
                    >
                      <LinkIcon className="w-4 h-4" />
                      <span>Open task link</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate text-center">{task.targetUrl}</p>
                  </div>
                )}

                {task.hasPostContent && (
                  <div className="rounded-2xl border border-violet-300/40 dark:border-violet-500/30 bg-violet-500/5 p-3 space-y-2 text-left">
                    <p className="text-[11px] font-black uppercase tracking-wider text-violet-600 dark:text-violet-300 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 shrink-0" /> What you will post
                    </p>
                    {task.postImageUrl ? (
                      <img src={task.postImageUrl} alt="Image to post" loading="lazy" className="w-full max-h-72 object-contain rounded-xl bg-white dark:bg-black/30" />
                    ) : (
                      <PostImagePlaceholder label="No image for this post" />
                    )}
                    <p className="text-[11px] text-violet-700 dark:text-violet-300">Your ready-to-post text appears after you reserve the task.</p>
                  </div>
                )}
                <p className="text-[10px] text-gray-400 dark:text-gray-500">
                  Reserving holds one of the task's slots under your account while you work.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <h2 className="text-base font-black text-gray-900 dark:text-gray-100">Submit your proof</h2>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    Upload a screenshot of the completed action and/or paste the proof link.
                  </p>
                </div>

                {/* Post text to copy-paste — provided by the platform (own version in auto mode). */}
                {task.hasPostContent && (
                  <ReadyToPostCard
                    personal={postContent.personal}
                    loading={postContent.loading}
                    text={postContent.text}
                    imageUrl={postContent.imageUrl}
                    error={postContent.error}
                  />
                )}

                {task.targetUrl && (
                  <a
                    href={task.targetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-3 rounded-2xl font-bold text-sm border-2 border-[#168BFF]/30 text-[#168BFF] hover:bg-[#168BFF]/5 transition-all flex items-center justify-center gap-2"
                  >
                    <LinkIcon className="w-4 h-4" />
                    <span>Open task link</span>
                  </a>
                )}

                {submitError && (
                  <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-xl" role="alert">{submitError}</div>
                )}

                {/* Screenshot upload */}
                <div>
                  <label htmlFor="proof-screenshot" className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">Screenshot proof</label>
                  {screenshot ? (
                    <div className="relative rounded-2xl overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-900">
                      <img src={screenshot} alt="Proof screenshot" className="w-full max-h-56 object-contain" />
                      <button
                        type="button"
                        onClick={() => {
                          setScreenshot(null);
                          setScreenshotName(null);
                        }}
                        className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"
                        aria-label="Remove screenshot"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <p className="absolute bottom-2 left-2 text-[10px] text-white/80 bg-black/50 rounded px-2 py-0.5 truncate max-w-[70%]">
                        {screenshotName}
                      </p>
                    </div>
                  ) : (
                    <label htmlFor="proof-screenshot" className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 dark:border-white/10 hover:border-[#168BFF] rounded-2xl p-6 cursor-pointer transition-colors bg-gray-50/50">
                      {preparingScreenshot ? (
                        <Loader2 className="w-6 h-6 text-gray-400 dark:text-gray-500 animate-spin" />
                      ) : (
                        <Upload className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                      )}
                      <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{preparingScreenshot ? 'Preparing screenshot…' : 'Tap to upload screenshot'}</span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">PNG or JPG, up to 8 MB — sent with your submission</span>
                      <input
                        id="proof-screenshot"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        disabled={preparingScreenshot}
                        onChange={(e) => void handleFile(e.target.files?.[0])}
                      />
                    </label>
                  )}
                </div>

                {/* Proof URL — pre-filled with the task link they visited */}
                <div>
                  <label htmlFor="proof-url" className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                    Proof link <span className="text-[#168BFF]">— the same link you visited above</span>
                  </label>
                  <div className="relative">
                    <LinkIcon className="w-4 h-4 text-gray-400 dark:text-gray-500 absolute left-3 top-3" />
                    <input
                      id="proof-url"
                      type="url"
                      value={proofUrl}
                      onChange={(e) => setProofUrl(e.target.value)}
                      placeholder="https://… link to your completed action"
                      className="w-full pl-9 pr-3 py-2.5 min-h-[44px] text-xs sm:text-sm bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:border-[#168BFF]"
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">This should match the task link — our system verifies it automatically.</p>
                </div>

                {/* Note */}
                <div>
                  <label htmlFor="proof-note" className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">Note for the reviewer (optional)</label>
                  <textarea
                    id="proof-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    maxLength={1000}
                    placeholder="Anything the reviewer should know…"
                    className="w-full px-3 py-2.5 min-h-[60px] text-xs sm:text-sm bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:border-[#168BFF] resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3.5 bg-[#16B364] hover:bg-[#12995a] text-white rounded-2xl font-black text-sm transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>{submitting ? 'Submitting…' : 'Submit proof for verification'}</span>
                </button>

                <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed">
                  Every submission is checked for duplicates, wrong URLs, and missing requirements before a moderator
                  approves it. Rewards move Submitted → Checking → Moderator review → Approved → Pending → Available.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
