import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Check,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  Loader2,
  Target,
  Globe,
  Wallet,
  Users,
  ClipboardList,
  Rocket,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { businessApi, getApiError, api } from '../../api';
import { COUNTRY_OPTIONS } from '../../config/geoLocations';
import { useAuth } from '../../context/AuthContext';
import { useRequireVerifiedEmail } from '../../components/auth/EmailVerification';
import { useMoney } from '../../hooks/useMoney';
import { TaskPreview, TaskPreviewSummary, classifyTaskPreview } from '../../components/task/TaskPreview';
import type { UiTask, Campaign } from '../../types';
import { dropdownListsApi, type WizardPreset } from '../../api/dropdownLists';
import { PostImagePicker } from '../../components/campaign/PostImagePicker';
import {
  InstagramLogo,
  TikTokLogo,
  YouTubeLogo,
  FacebookLogo,
  XTwitterLogo,
  WhatsAppLogo,
  TrustpilotLogo,
  GoogleReviewLogo,
} from '../../components/common/PlatformIcons';

/**
 * 6-step campaign wizard, in the owner-specified order:
 *  1 Goal → 2 Platform → 3 Task type → 4 Reward & budget → 5 Target audience → 6 Review & submit
 *
 * Step 6 renders a live TaskPreview built from the wizard state, so the
 * business sees exactly what contributors will see before spending budget.
 *
 * The platform choice (step 2) is sent as `platform` and persisted on the
 * campaign row and the materialized task pool. Step 3 picks a task type
 * from the public /task-types catalog (sent as `task_type_key`) — the
 * backend requires it and enforces the type's reward band.
 */

const STEPS = [
  { id: 1, label: 'Goal', icon: Target },
  { id: 2, label: 'Platform', icon: Globe },
  { id: 3, label: 'Task Type', icon: ClipboardList },
  { id: 4, label: 'Reward', icon: Wallet },
  { id: 5, label: 'Audience', icon: Users },
  { id: 6, label: 'Review', icon: Rocket },
];

const PLATFORMS = [
  { name: 'Instagram', icon: InstagramLogo, hint: 'Follows, likes, story shares' },
  { name: 'TikTok', icon: TikTokLogo, hint: 'Video views, follows, shares' },
  { name: 'YouTube', icon: YouTubeLogo, hint: 'Subscribes, likes, comments' },
  { name: 'Facebook', icon: FacebookLogo, hint: 'Page likes, shares, posts' },
  { name: 'X', icon: XTwitterLogo, hint: 'Follows, reposts, likes' },
  { name: 'WhatsApp', icon: WhatsAppLogo, hint: 'Group shares, invites' },
  { name: 'Google Reviews', icon: GoogleReviewLogo, hint: 'Honest business reviews' },
  { name: 'Trustpilot', icon: TrustpilotLogo, hint: 'Verified service reviews' },
];

interface TaskCategory {
  id: number;
  name: string;
  description?: string | null;
  is_active?: boolean;
}

/** Public /task-types catalog entry: proof contract + enforceable reward band. */
interface TaskType {
  key: string;
  name: string;
  description?: string | null;
  is_allowed?: boolean;
  policy_note?: string | null;
  reward_band_min_cents: number;
  reward_band_max_cents: number;
  allowed_platforms?: string[];
}

// Sanity floor only — the selected task type's reward band is the real rule
// (e.g. Follow allows $0.10–$0.20).
const MIN_REWARD_USD = 0.01;
const MIN_CONTRIBUTORS = 5;
/** Estimated platform fee mirrored from backend config (platform.platformFeePercent, default 15).
 *  The backend is the source of truth — it recalculates the fee and verifies
 *  the balance at launch. This number is only a preview. */
const ESTIMATED_FEE_PERCENT = 15;

const CONTRIBUTOR_LEVELS = ['starter', 'explorer', 'trusted', 'pro', 'elite'] as const;

/** Template → category-name matching used when the Task Library links here. */
const TEMPLATE_TO_CATEGORY = (template: string, categories: TaskCategory[]): TaskCategory | undefined => {
  const t = template.toLowerCase();
  const byName = (needle: string) => categories.find((c) => c.name.toLowerCase().includes(needle));
  if (t.includes('tiktok') || t.includes('video')) return byName('ugc') || byName('video') || byName('content');
  if (t.includes('comment') || t.includes('youtube')) return byName('comment') || byName('engagement');
  if (t.includes('share') || t.includes('story') || t.includes('repost') || t.includes('whatsapp'))
    return byName('share') || byName('engagement') || byName('social');
  if (t.includes('app')) return byName('test') || byName('survey') || categories[0];
  return categories[0];
};

/** Template → platform pre-selection. */
const TEMPLATE_TO_PLATFORM: Record<string, string> = {
  tiktok: 'TikTok',
  share: 'Instagram',
  comment: 'YouTube',
  whatsapp: 'WhatsApp',
  app: 'Instagram',
};

/** Template → task-type pre-selection (matches the public /task-types catalog keys). */
const TEMPLATE_TO_TASK_TYPE: Record<string, string> = {
  tiktok: 'follow',
  share: 'share',
  comment: 'like_comment',
  whatsapp: 'share',
  app: 'app_test',
  survey: 'survey',
};

export const CreateCampaignWizardPage: React.FC = () => {
  const navigate = useNavigate();
  const { requireVerified, gate } = useRequireVerifiedEmail();
  const { fmt, converted, displayCurrency } = useMoney();
  const [searchParams] = useSearchParams();
  const templateHint = searchParams.get('template');
  const { user } = useAuth();

  const [step, setStep] = useState(1);
  const [categories, setCategories] = useState<TaskCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [taskTypesLoading, setTaskTypesLoading] = useState(true);
  const [taskTypesError, setTaskTypesError] = useState<string | null>(null);
  // Resume-draft mode: ?draft=<campaignId> pre-fills the wizard from a saved draft.
  const [draftId] = useState<string | null>(() => searchParams.get('draft'));
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  // Stable per wizard-session idempotency key: a retried / double-clicked
  // Launch resolves to the same campaign instead of escrow-holding twice.
  const [idempotencyKey] = useState<string>(() =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  // Step 1 — Goal
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [description, setDescription] = useState('');

  // Step 2 — Platform
  const [platform, setPlatform] = useState<string>('Instagram');

  // Step 3 — Task type
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [taskTypeKey, setTaskTypeKey] = useState<string>('');

  // Step 4 — Reward
  const [rewardUsd, setRewardUsd] = useState<string>('0.20');
  const [contributors, setContributors] = useState<string>('5');
  const [instructions, setInstructions] = useState('');
  const [proofRequirements, setProofRequirements] = useState<string[]>(['Screenshot']);

  // AI-generated post content (for copy-paste tasks: comments, reviews, captions)
  const [contentMode, setContentMode] = useState<'none' | 'manual' | 'auto'>('none');
  const [contentBrief, setContentBrief] = useState('');
  const [generatedContent, setGeneratedContent] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  // Post image: chosen file (uploaded once the campaign / draft exists),
  // the already-uploaded one (draft resume), and a pending removal.
  const [postImageFile, setPostImageFile] = useState<File | null>(null);
  const [postImageUrl, setPostImageUrl] = useState<string | null>(null);
  const [removePostImage, setRemovePostImage] = useState(false);

  /** Upload / remove the post image for a saved campaign. Returns an error text or null. */
  const syncPostImage = async (campaignId: number | string): Promise<string | null> => {
    try {
      // The image is the creative itself — it uploads in every mode,
      // including "No post text" (image-only tasks). It used to be skipped
      // unless a post-text mode was picked, so image-only campaigns went
      // live with no image attached at all.
      if (postImageFile) {
        const res = await businessApi.uploadContentImage(campaignId, postImageFile);
        setPostImageUrl(res.data?.content_image_url ?? null);
        setPostImageFile(null);
      } else if (removePostImage && postImageUrl) {
        await businessApi.removeContentImage(campaignId);
        setPostImageUrl(null);
        setRemovePostImage(false);
      }
      return null;
    } catch (e) {
      return `the post image could not be uploaded: ${getApiError(e, 'please try again')}.`;
    }
  };

  // Step 5 — Audience
  const [country, setCountry] = useState('GLOBAL');
  const [minLevel, setMinLevel] = useState<string>('');
  const [retentionHours, setRetentionHours] = useState('');

  // Launch
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [launchSuccessId, setLaunchSuccessId] = useState<number | null>(null);
  // Draft save (step 6 secondary action — no money moves)
  const [savingDraft, setSavingDraft] = useState(false);

  useEffect(() => {
    // Wizard preset for ?template=… (Super Admin → Task Library → Wizard
    // presets); the built-in mapping below is only a fallback.
    let preset: WizardPreset | undefined;
    const fetchPreset = async () => {
      if (!templateHint) return;
      try {
        const res = await dropdownListsApi.publicPresets();
        preset = res.data.find((p) => p.key === templateHint.toLowerCase());
      } catch {
        preset = undefined;
      }
    };
    const fetchCategories = async () => {
      setCategoriesLoading(true);
      setCategoriesError(null);
      try {
        const res = await api.get<TaskCategory[]>('/task-categories');
        const list = (res.data as unknown as { data?: TaskCategory[] }).data ?? (res.data as unknown as TaskCategory[]);
        const cats = Array.isArray(list) ? list : [];
        setCategories(cats);
        if (templateHint && cats.length > 0) {
          const match = (preset?.category_id && cats.find((c) => c.id === preset?.category_id)) || TEMPLATE_TO_CATEGORY(templateHint, cats);
          if (match) setCategoryId(match.id);
          const plat = preset?.platform || TEMPLATE_TO_PLATFORM[templateHint.toLowerCase()];
          if (plat) setPlatform(plat);
        }
      } catch (e) {
        setCategoriesError(getApiError(e, 'Could not load task categories.'));
      } finally {
        setCategoriesLoading(false);
      }
    };
    const fetchTaskTypes = async () => {
      setTaskTypesLoading(true);
      setTaskTypesError(null);
      try {
        const res = await api.get<TaskType[]>('/task-types');
        const list = (res.data as unknown as { data?: TaskType[] }).data ?? (res.data as unknown as TaskType[]);
        const types = (Array.isArray(list) ? list : []).filter((t) => t.is_allowed !== false);
        setTaskTypes(types);
        if (templateHint) {
          const key = preset?.task_type_key || TEMPLATE_TO_TASK_TYPE[templateHint.toLowerCase()];
          if (key && types.some((t) => t.key === key)) setTaskTypeKey(key);
        }
      } catch (e) {
        setTaskTypesError(getApiError(e, 'Could not load task types.'));
      } finally {
        setTaskTypesLoading(false);
      }
    };
    void fetchPreset().then(() => {
      void fetchCategories();
      void fetchTaskTypes();
    });
  }, [templateHint]);

  // Resume mode: ?draft=<id> pre-fills the wizard from a saved draft so the
  // business can finish it later instead of starting over.
  useEffect(() => {
    if (!draftId) return;
    const loadDraft = async () => {
      setDraftLoading(true);
      setDraftError(null);
      try {
        const res = await businessApi.campaign(draftId);
        // The show endpoint wraps as data: { campaign, submissions } —
        // unwrap the campaign (typed in src/api/business.ts).
        const d = res.success ? (res.data.campaign as (Campaign & { platform?: string }) | undefined) : undefined;
        if (!res.success || !d) {
          setDraftError(res.message || 'Could not load the draft.');
          return;
        }
        if (d.status !== 'draft') {
          setDraftError('This campaign is no longer a draft and cannot be edited here.');
          return;
        }
        setTitle(d.title || '');
        setObjective(d.objective || '');
        setDescription(d.description || '');
        if (d.platform) setPlatform(d.platform);
        if (d.category_id) setCategoryId(d.category_id);
        const wizard = (d.proof_requirements_json as unknown as { wizard?: { task_type_key?: string } } | undefined)
          ?.wizard;
        if (wizard?.task_type_key) setTaskTypeKey(wizard.task_type_key);
        if (d.reward_per_task_cents) setRewardUsd(String(d.reward_per_task_cents / 100));
        if (d.target_contributors_count) setContributors(String(d.target_contributors_count));
        if (d.instructions_markdown) setInstructions(d.instructions_markdown);
        if (d.content_mode) setContentMode(d.content_mode);
        if (d.generated_content) setGeneratedContent(d.generated_content);
        if (d.content_brief) setContentBrief(d.content_brief);
        if (d.content_image_url) setPostImageUrl(d.content_image_url);
        // Proof chips: fresh wizard posts an array; a saved draft merges the
        // array with the stashed `wizard` answers object — accept both.
        const proof = d.proof_requirements_json as unknown;
        if (Array.isArray(proof)) {
          const chips = proof.filter((p): p is string => typeof p === 'string');
          if (chips.length > 0) setProofRequirements(chips);
        } else if (proof && typeof proof === 'object') {
          const chips = Object.entries(proof as Record<string, unknown>)
            .filter(([k, v]) => k !== 'wizard' && typeof v === 'string')
            .map(([, v]) => v as string);
          if (chips.length > 0) setProofRequirements(chips);
        }
        const countries = d.target_countries_json;
        if (countries && countries.length > 0) setCountry(countries[0] === 'ALL' ? 'GLOBAL' : countries[0]);
        if (d.min_contributor_level) setMinLevel(d.min_contributor_level);
        if (d.retention_hours) setRetentionHours(String(d.retention_hours));
      } catch (e) {
        setDraftError(getApiError(e, 'Could not load the draft.'));
      } finally {
        setDraftLoading(false);
      }
    };
    void loadDraft();
  }, [draftId]);

  const rewardCents = Math.round((parseFloat(rewardUsd) || 0) * 100);
  const contributorCount = parseInt(contributors, 10) || 0;

  const estimate = useMemo(() => {
    const tasksBudget = rewardCents * contributorCount;
    const fee = Math.round(tasksBudget * (ESTIMATED_FEE_PERCENT / 100));
    return { tasksBudget, fee, total: tasksBudget + fee };
  }, [rewardCents, contributorCount]);

  const fmtUsd = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const selectedTaskType = taskTypes.find((t) => t.key === taskTypeKey);

  const validateStep = (s: number): boolean => {
    setFieldErrors({});
    if (s === 1) {
      const errs: Record<string, string[]> = {};
      if (title.trim().length < 5) errs.title = ['Give your campaign a clear title (min 5 characters).'];
      if (description.trim().length < 20) errs.description = ['Describe the campaign in at least 20 characters.'];
      setFieldErrors(errs);
      return Object.keys(errs).length === 0;
    }
    if (s === 2) {
      if (!platform) {
        setFieldErrors({ platform: ['Pick the platform where contributors will act.'] });
        return false;
      }
      return true;
    }
    if (s === 3) {
      const errs: Record<string, string[]> = {};
      if (categoryId == null) errs.category_id = ['Pick the category that best matches this campaign.'];
      if (!taskTypeKey) errs.task_type_key = ['Pick the task type — it sets the proof contributors must submit and the allowed reward range.'];
      setFieldErrors(errs);
      return Object.keys(errs).length === 0;
    }
    if (s === 4) {
      const errs: Record<string, string[]> = {};
      const cents = Math.round((parseFloat(rewardUsd) || 0) * 100);
      const bandMin = selectedTaskType ? Math.max(MIN_REWARD_USD * 100, selectedTaskType.reward_band_min_cents) : MIN_REWARD_USD * 100;
      const bandMax = selectedTaskType?.reward_band_max_cents;
      if (bandMax != null && bandMax < bandMin) {
        errs.reward = [
          `“${selectedTaskType?.name}” pays at most ${fmtUsd(bandMax)}, below the $${MIN_REWARD_USD.toFixed(2)} platform minimum — pick a different task type.`,
        ];
      } else if (!(cents >= bandMin) || (bandMax != null && !(cents <= bandMax))) {
        errs.reward = selectedTaskType
          ? [`Reward must be between ${fmtUsd(bandMin)} and ${fmtUsd(bandMax ?? bandMin)} per task for “${selectedTaskType.name}”.`]
          : [`Reward must be at least $${MIN_REWARD_USD.toFixed(2)} per task (platform minimum).`];
      }
      if (!(contributorCount >= MIN_CONTRIBUTORS))
        errs.contributors = [`You need at least ${MIN_CONTRIBUTORS} contributors.`];
      if (instructions.trim().length < 10)
        errs.instructions = ['Write clear step-by-step instructions (min 10 characters).'];
      setFieldErrors(errs);
      return Object.keys(errs).length === 0;
    }
    return true;
  };

  const next = () => {
    if (validateStep(step)) setStep((s) => Math.min(6, s + 1));
  };
  const back = () => {
    setLaunchError(null);
    setStep((s) => Math.max(1, s - 1));
  };

  const toggleProofRequirement = (req: string) => {
    setProofRequirements((prev) => (prev.includes(req) ? prev.filter((r) => r !== req) : [...prev, req]));
  };

  /** Wizard state mapped to the draft endpoint's field names (draft create + update). */
  const draftPayload = (): Record<string, unknown> => {
    const p: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim(),
      category_id: categoryId,
      task_type_key: taskTypeKey,
      platform,
      reward_cents: rewardCents,
      contributors: contributorCount,
      instructions: instructions.trim(),
      proof_requirements: proofRequirements,
      countries: [country === 'GLOBAL' ? 'ALL' : country],
    };
    if (objective.trim()) p.objective = objective.trim();
    // Post content travels with the draft (staff approve it after launch).
    p.content_mode = contentMode === 'none' ? null : contentMode;
    if (contentMode !== 'none') {
      p.generated_content = generatedContent.trim();
      if (contentBrief.trim()) p.content_brief = contentBrief.trim();
    }
    if (country !== 'GLOBAL') p.country_code = country;
    if (minLevel) p.min_contributor_level = minLevel;
    if (retentionHours && parseInt(retentionHours, 10) >= 0)
      p.retention_days = Math.max(1, Math.ceil(parseInt(retentionHours, 10) / 24));
    return p;
  };

  const handleSaveDraft = async () => {
    // Saving a draft moves no money, but keep the verified-email gate consistent.
    if (!requireVerified()) return;
    if (savingDraft || launching) return;
    if (!validateStep(1) || !validateStep(2) || !validateStep(3) || !validateStep(4)) {
      setLaunchError('Please complete steps 1–4 before saving a draft.');
      return;
    }
    setSavingDraft(true);
    setLaunchError(null);
    setFieldErrors({});
    try {
      const res = draftId
        ? await businessApi.updateCampaignDraft(draftId, draftPayload())
        : await businessApi.saveCampaignDraft(draftPayload());
      if (res.success && res.data) {
        const imageError = await syncPostImage(res.data.id);
        if (imageError) {
          setLaunchError(`Draft saved, but ${imageError}`);
          return;
        }
        navigate('/business/campaigns?tab=draft');
      } else {
        setLaunchError(res.message || 'Draft could not be saved. Please try again.');
      }
    } catch (e: unknown) {
      const apiErr = e as { response?: { data?: { message?: string } } };
      setLaunchError(apiErr.response?.data?.message || getApiError(e, 'Draft could not be saved. Please try again.'));
    } finally {
      setSavingDraft(false);
    }
  };

  const handleLaunch = async () => {
    // Launching a campaign spends real budget — verified email required.
    if (!requireVerified()) return;
    if (launching || !validateStep(4) || !validateStep(1) || categoryId == null || !taskTypeKey || !platform) return;
    setLaunching(true);
    setLaunchError(null);
    setFieldErrors({});
    try {
      if (draftId) {
        // Resume mode: sync any edits onto the draft row first, then launch
        // the draft itself — one campaign, one escrow hold, no duplicates.
        const sync = await businessApi.updateCampaignDraft(draftId, draftPayload());
        if (!sync.success) {
          setLaunchError(sync.message || 'Could not save the draft before launch. Please try again.');
          return;
        }
        const imageError = await syncPostImage(draftId);
        if (imageError) {
          setLaunchError(imageError);
          return;
        }
        const res = await businessApi.launchDraft(draftId, idempotencyKey);
        if (res.success && res.data) {
          setLaunchSuccessId(res.data.id);
        } else {
          setLaunchError(res.message || 'Campaign could not be launched. Please try again.');
        }
        return;
      }
      const payload: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim(),
        category_id: categoryId,
        task_type_key: taskTypeKey,
        platform,
        reward_per_task_cents: rewardCents,
        target_contributors_count: contributorCount,
        instructions_markdown: instructions.trim(),
        proof_requirements_json: proofRequirements,
        target_countries: [country === 'GLOBAL' ? 'ALL' : country],
        idempotency_key: idempotencyKey,
        // Post content contributors copy-paste (staff approve it first).
        ...(contentMode !== 'none'
          ? {
              content_mode: contentMode,
              generated_content: generatedContent.trim(),
              ...(contentBrief.trim() ? { content_brief: contentBrief.trim() } : {}),
            }
          : {}),
      };
      if (objective.trim()) payload.objective = objective.trim();
      if (minLevel) payload.min_contributor_level = minLevel;
      if (retentionHours && parseInt(retentionHours, 10) >= 0) payload.retention_hours = parseInt(retentionHours, 10);

      const res = await businessApi.createCampaign(payload);
      if (res.success && res.data) {
        // The campaign exists now; attach the post image to it.
        const imageError = await syncPostImage(res.data.id);
        if (imageError) setLaunchError(`Campaign created, but ${imageError} You can add it from the campaign page.`);
        setLaunchSuccessId(res.data.id);
      } else {
        setLaunchError(res.message || 'Campaign could not be created. Please try again.');
      }
    } catch (e: unknown) {
      // Surface real API errors — especially the 422 funding gate — honestly.
      const apiErr = e as {
        response?: { status?: number; data?: { errors?: Record<string, string[]>; message?: string } };
      };
      const status = apiErr.response?.status;
      const errors = apiErr.response?.data?.errors;
      if (status === 422 && errors) setFieldErrors(errors);
      const msg = apiErr.response?.data?.message || getApiError(e, 'Campaign could not be created.');
      setLaunchError(
        status === 422 && msg.includes('funds')
          ? `${msg} Top up your balance (Billing & Invoices → contact support) and try again.`
          : msg,
      );
    } finally {
      setLaunching(false);
    }
  };

  const progress = Math.round((step / STEPS.length) * 100);
  const err = (key: string) => fieldErrors[key]?.[0];
  const selectedCategory = categories.find((c) => c.id === categoryId);

  /** Synthesized task payload for the live preview — built only from wizard fields. */
  const previewTask: UiTask = {
    id: 0,
    uuid: 'preview',
    campaign_id: 0,
    category_id: categoryId ?? 0,
    title: title.trim() || 'Your campaign title',
    reward_cents: rewardCents || 20,
    estimated_minutes: 5,
    difficulty: 'easy',
    status: 'available',
    slots_total: contributorCount || 5,
    slots_taken: 0,
    platform,
    categoryName: selectedCategory?.name || 'Social Media',
    description: description.trim() || title.trim() || 'Your campaign description will appear here.',
    country: country === 'GLOBAL' ? 'Global' : country,
    retentionHours: parseInt(retentionHours, 10) >= 0 ? parseInt(retentionHours, 10) : 24,
    brandName: user?.business?.company_name || user?.name || 'Your brand',
    targetUrl: user?.business?.website,
    postCopy: instructions.trim() || 'Your step-by-step instructions will appear here.',
    campaign: {
      id: 0,
      uuid: 'preview',
      business_id: 0,
      category_id: categoryId ?? 0,
      title: title.trim() || 'Your campaign title',
      description: description.trim(),
      instructions_markdown: instructions.trim(),
      proof_requirements_json: proofRequirements,
      status: 'draft',
      total_budget_cents: estimate.total,
      remaining_budget_cents: estimate.total,
      reserved_budget_cents: 0,
      reward_per_task_cents: rewardCents,
      platform_fee_cents: estimate.fee,
      target_contributors_count: contributorCount || 5,
      completed_contributors_count: 0,
      min_contributor_level: 'starter',
      retention_hours: parseInt(retentionHours, 10) >= 0 ? parseInt(retentionHours, 10) : 24,
    } as UiTask['campaign'],
  };
  const previewVariant = classifyTaskPreview(previewTask);

  const reviewRows: [string, string][] = [
    ['Title', previewTask.title],
    ['Platform', platform],
    ['Category', selectedCategory?.name || '—'],
    ['Task type', selectedTaskType?.name || '—'],
    ['Target audience', COUNTRY_OPTIONS.find((c) => c.code === country)?.label || country],
    ['Reward / task', fmtUsd(rewardCents)],
    ['Contributors', String(contributorCount || 0)],
    ['Proof required', proofRequirements.join(', ') || '—'],
    ['Min. contributor level', minLevel || 'Any'],
    ['Retention', retentionHours ? `${retentionHours} hours` : '24 hours (default)'],
    ['Estimated total', `${fmtUsd(estimate.total)} (incl. est. ${ESTIMATED_FEE_PERCENT}% fee)`],
  ];

  if (launchSuccessId != null) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 space-y-5">
        <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-gray-100">Campaign funded — pending review</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Your budget hold is on file and your campaign was submitted for review. New campaigns go live after a
          quick review by our team — you will find it under Campaigns once it is approved.
        </p>
        <button
          type="button"
          onClick={() => navigate(`/business/campaigns/${launchSuccessId}`)}
          className="px-6 py-3 bg-[#168BFF] hover:bg-[#1275DD] text-white text-sm font-bold rounded-xl transition-colors"
        >
          View campaign
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {gate}
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-gray-100 tracking-tight">
          {draftId ? 'Edit Campaign Draft' : 'Create Campaign'}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Real budget, real contributors, real verification.</p>
      </div>

      {draftId && (
        <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-2xl px-5 py-3.5 text-sm">
          {draftLoading ? (
            <p className="flex items-center gap-2 text-blue-700 dark:text-blue-300 font-bold">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading your saved draft…
            </p>
          ) : draftError ? (
            <div>
              <p className="font-bold text-red-700 dark:text-red-300">Could not resume the draft</p>
              <p className="text-red-600 dark:text-red-400 mt-1">{draftError}</p>
            </div>
          ) : (
            <p className="text-blue-800 dark:text-blue-200">
              <span className="font-bold">Editing a saved draft.</span> Launching funds and submits this
              campaign — no duplicate is created.
            </p>
          )}
        </div>
      )}

      {/* Progress */}
      <div className="bg-white dark:bg-[#0C1322] rounded-2xl border border-[#E7ECF3] dark:border-white/10 shadow-xs p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-gray-900 dark:text-gray-100">
            Step {step} of {STEPS.length} — {STEPS[step - 1].label}
          </span>
          <span className="text-xs font-bold text-[#168BFF]">{progress}%</span>
        </div>
        <div className="h-2 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
          <div className="h-full bg-[#168BFF] rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex gap-1.5 mt-4 flex-wrap">
          {STEPS.map((s) => (
            <div
              key={s.id}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold ${
                s.id === step
                  ? 'bg-[#168BFF] text-white'
                  : s.id < step
                    ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-gray-100 dark:bg-white/10 text-gray-400 dark:text-gray-500'
              }`}
            >
              {s.id < step ? <Check className="w-3 h-3" /> : <s.icon className="w-3 h-3" />}
              {s.label}
            </div>
          ))}
        </div>
      </div>

      {/* ============ STEP 1: GOAL ============ */}
      {step === 1 && (
        <div className="bg-white dark:bg-[#0C1322] rounded-2xl border border-[#E7ECF3] dark:border-white/10 shadow-xs p-6 space-y-5">
          <div>
            <label className="text-xs font-bold text-gray-700 dark:text-gray-300 block mb-1.5">Campaign title *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Launch our new coffee brand on Instagram"
              className="w-full px-4 py-3 border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#168BFF]/30 focus:border-[#168BFF]"
            />
            {err('title') && <p className="text-[11px] font-bold text-red-600 dark:text-red-400 mt-1">{err('title')}</p>}
          </div>
          <div>
            <label className="text-xs font-bold text-gray-700 dark:text-gray-300 block mb-1.5">Objective (optional)</label>
            <input
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="e.g. Drive 500 authentic follows this month"
              className="w-full px-4 py-3 border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#168BFF]/30 focus:border-[#168BFF]"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-700 dark:text-gray-300 block mb-1.5">Campaign description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="What is this campaign about? What will contributors be doing?"
              className="w-full px-4 py-3 border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#168BFF]/30 focus:border-[#168BFF] resize-none"
            />
            {err('description') && <p className="text-[11px] font-bold text-red-600 dark:text-red-400 mt-1">{err('description')}</p>}
          </div>
        </div>
      )}

      {/* ============ STEP 2: PLATFORM ============ */}
      {step === 2 && (
        <div className="bg-white dark:bg-[#0C1322] rounded-2xl border border-[#E7ECF3] dark:border-white/10 shadow-xs p-6 space-y-4">
          <div>
            <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Where will contributors act?</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              Choose the platform for this campaign. It is saved with your campaign and drives the task preview
              contributors will see.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PLATFORMS.map((p) => {
              const Icon = p.icon;
              const selected = platform === p.name;
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setPlatform(p.name)}
                  className={`text-left p-4 rounded-xl border-2 transition-all ${
                    selected ? 'border-[#168BFF] bg-blue-50 dark:bg-blue-500/10 shadow-sm' : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'
                  }`}
                  aria-pressed={selected}
                >
                  <Icon className="w-7 h-7" />
                  <p className="text-xs font-extrabold text-gray-900 dark:text-gray-100 mt-2.5 flex items-center gap-1.5">
                    {selected && <Check className="w-3.5 h-3.5 text-[#168BFF]" />}
                    {p.name}
                  </p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">{p.hint}</p>
                </button>
              );
            })}
          </div>
          {err('platform') && <p className="text-[11px] font-bold text-red-600 dark:text-red-400">{err('platform')}</p>}
        </div>
      )}

      {/* ============ STEP 3: TASK TYPE ============ */}
      {step === 3 && (
        <div className="bg-white dark:bg-[#0C1322] rounded-2xl border border-[#E7ECF3] dark:border-white/10 shadow-xs p-6 space-y-4">
          <div>
            <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Category</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              The category this campaign appears under.
            </p>
          </div>
          {categoriesLoading && (
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm py-6">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading task categories…
            </div>
          )}
          {categoriesError && !categoriesLoading && (
            <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4 text-sm">
              <p className="font-bold text-red-700 dark:text-red-300">Could not load categories</p>
              <p className="text-red-600 dark:text-red-400 mt-1">{categoriesError}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-2 text-xs font-bold text-red-700 dark:text-red-300 underline"
              >
                Reload
              </button>
            </div>
          )}
          {!categoriesLoading && !categoriesError && (
            <div className="grid sm:grid-cols-2 gap-3">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryId(c.id)}
                  className={`text-left p-4 rounded-xl border-2 transition-all ${
                    categoryId === c.id ? 'border-[#168BFF] bg-blue-50 dark:bg-blue-500/10' : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'
                  }`}
                  aria-pressed={categoryId === c.id}
                >
                  <p className="text-sm font-extrabold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    {categoryId === c.id && <Check className="w-4 h-4 text-[#168BFF]" />}
                    {c.name}
                  </p>
                  {c.description && <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{c.description}</p>}
                </button>
              ))}
            </div>
          )}
          {err('category_id') && <p className="text-[11px] font-bold text-red-600 dark:text-red-400">{err('category_id')}</p>}

          <div className="pt-2">
            <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Task type *</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              What exactly contributors do on{' '}
              <span className="font-bold text-gray-700 dark:text-gray-300">{platform}</span> — sets the proof they
              must submit and the allowed reward range.
            </p>
          </div>
          {taskTypesLoading && (
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm py-6">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading task types…
            </div>
          )}
          {taskTypesError && !taskTypesLoading && (
            <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4 text-sm">
              <p className="font-bold text-red-700 dark:text-red-300">Could not load task types</p>
              <p className="text-red-600 dark:text-red-400 mt-1">{taskTypesError}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-2 text-xs font-bold text-red-700 dark:text-red-300 underline"
              >
                Reload
              </button>
            </div>
          )}
          {!taskTypesLoading && !taskTypesError && taskTypes.length === 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 py-4">
              No task types are available right now. Please reload the page or try again later.
            </p>
          )}
          {!taskTypesLoading && !taskTypesError && taskTypes.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-3">
              {taskTypes.map((t) => {
                const selected = taskTypeKey === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTaskTypeKey(t.key)}
                    className={`text-left p-4 rounded-xl border-2 transition-all ${
                      selected ? 'border-[#168BFF] bg-blue-50 dark:bg-blue-500/10' : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'
                    }`}
                    aria-pressed={selected}
                  >
                    <p className="text-sm font-extrabold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                      {selected && <Check className="w-4 h-4 text-[#168BFF]" />}
                      {t.name}
                    </p>
                    {t.description && <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{t.description}</p>}
                    <p className="text-[11px] font-bold text-[#168BFF] mt-1.5">
                      {fmtUsd(t.reward_band_min_cents)} – {fmtUsd(t.reward_band_max_cents)} per task
                    </p>
                    {t.policy_note && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 leading-snug">{t.policy_note}</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {err('task_type_key') && <p className="text-[11px] font-bold text-red-600 dark:text-red-400">{err('task_type_key')}</p>}
        </div>
      )}

      {/* ============ STEP 4: REWARD ============ */}
      {step === 4 && (
        <div className="bg-white dark:bg-[#0C1322] rounded-2xl border border-[#E7ECF3] dark:border-white/10 shadow-xs p-6 space-y-5">
          <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Reward & task instructions</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-gray-700 dark:text-gray-300 block mb-1.5">Reward per task (USD) *</label>
              <input
                type="number"
                min={MIN_REWARD_USD}
                step="0.01"
                value={rewardUsd}
                onChange={(e) => setRewardUsd(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#168BFF]/30 focus:border-[#168BFF]"
              />
              {err('reward') && <p className="text-[11px] font-bold text-red-600 dark:text-red-400 mt-1">{err('reward')}</p>}
              {converted && rewardCents > 0 && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                  ≈ <span className="notranslate" translate="no">{fmt(rewardCents)}</span> per task in your currency (estimate).
                </p>
              )}
              {selectedTaskType && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  “{selectedTaskType.name}” allows{' '}
                  {fmtUsd(Math.max(MIN_REWARD_USD * 100, selectedTaskType.reward_band_min_cents))} –{' '}
                  {fmtUsd(selectedTaskType.reward_band_max_cents)} per task.
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-bold text-gray-700 dark:text-gray-300 block mb-1.5">Number of contributors *</label>
              <input
                type="number"
                min={MIN_CONTRIBUTORS}
                value={contributors}
                onChange={(e) => setContributors(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#168BFF]/30 focus:border-[#168BFF]"
              />
              {err('contributors') && <p className="text-[11px] font-bold text-red-600 dark:text-red-400 mt-1">{err('contributors')}</p>}
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Minimum: {MIN_CONTRIBUTORS}.</p>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-700 dark:text-gray-300 block mb-1.5">Step-by-step instructions for contributors *</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={5}
              placeholder={'1. Follow @yourbrand on Instagram\n2. Like the pinned post\n3. Leave a genuine comment\n4. Take a screenshot as proof'}
              className="w-full px-4 py-3 border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#168BFF]/30 focus:border-[#168BFF] resize-none"
            />
            {err('instructions') && <p className="text-[11px] font-bold text-red-600 dark:text-red-400 mt-1">{err('instructions')}</p>}
          </div>

          {/* Post content contributors copy-paste: manual (one approved text)
              or auto (each contributor gets their own AI rewording of the
              approved sample). Staff approve it before the tasks go live. */}
          <div className="bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5 border-2 border-violet-200 dark:border-violet-500/25 rounded-2xl p-5 space-y-4">
            <div>
              <h4 className="text-sm font-extrabold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-300" />
                Post content for contributors
              </h4>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                The text contributors copy and paste. Our team reviews it before the tasks go live.
              </p>
            </div>
            <div className="grid sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Post content">
              {(
                [
                  { key: 'none', title: 'No post text', hint: 'Contributors follow the instructions only.' },
                  { key: 'manual', title: 'Manual', hint: 'One text you write (or generate) — everyone copies the same.' },
                  { key: 'auto', title: 'Auto (AI)', hint: 'You approve a sample; each contributor gets their own reworded version.' },
                ] as const
              ).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={contentMode === o.key}
                  onClick={() => setContentMode(o.key)}
                  className={`text-left p-3 rounded-xl border-2 transition-all ${
                    contentMode === o.key
                      ? 'border-violet-500 bg-white dark:bg-violet-500/10'
                      : 'border-gray-200 dark:border-white/10 bg-white/60 dark:bg-white/5 hover:border-violet-300'
                  }`}
                >
                  <span className="block text-xs font-black text-gray-900 dark:text-gray-100">{o.title}</span>
                  <span className="block text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{o.hint}</span>
                </button>
              ))}
            </div>
            {contentMode !== 'none' && (
            <>
            <div>
              <label className="text-xs font-bold text-gray-700 dark:text-gray-300 block mb-1.5">What is this post for?</label>
              <input
                value={contentBrief}
                onChange={(e) => setContentBrief(e.target.value)}
                placeholder="e.g. A Google review for our Dubai restaurant, praising the food and service"
                maxLength={500}
                className="w-full px-4 py-3 border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
              />
            </div>
            <button
              type="button"
              disabled={contentBrief.trim().length < 10 || generating}
              onClick={async () => {
                setGenerating(true);
                setGenError(null);
                try {
                  const res = await businessApi.generateContent(platform || 'instagram', contentBrief.trim());
                  if (res.success && res.content) {
                    setGeneratedContent(res.content);
                  } else {
                    setGenError(res.message || 'Could not generate content.');
                  }
                } catch (e) {
                  setGenError(getApiError(e, 'Could not generate content.'));
                } finally {
                  setGenerating(false);
                }
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-violet-600 hover:bg-violet-700 transition-colors disabled:opacity-50"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generating ? 'Generating…' : 'Generate with AI'}
            </button>
            {contentBrief.trim().length < 10 && !generating && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {contentBrief.trim()
                  ? `Add a little more detail (${contentBrief.trim().length}/10 characters), e.g. “Promote our new coffee shop in Dubai Marina”.`
                  : 'Type what the post is for above (at least 10 characters), then tap Generate with AI.'}
              </p>
            )}
            {genError && <p className="text-[11px] font-bold text-red-600 dark:text-red-400">{genError}</p>}
            {(contentMode === 'manual' || generatedContent) && (
              <div>
                <label className="text-xs font-bold text-gray-700 dark:text-gray-300 block mb-1">
                  {contentMode === 'auto' ? 'Approved sample — each contributor gets their own version of this *' : 'Post text — contributors copy this *'}
                </label>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">
                  {contentMode === 'manual' ? 'Write it yourself or generate it above, then edit. ' : 'You can edit it. '}
                  Keep the language clean and respectful — offensive or inappropriate words are blocked.
                </p>
                <textarea
                  value={generatedContent}
                  onChange={(e) => setGeneratedContent(e.target.value)}
                  rows={6}
                  maxLength={2000}
                  className="w-full px-4 py-3 border border-violet-200 dark:border-violet-500/25 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 resize-none bg-white dark:bg-white/5"
                />
                <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                  {contentMode === 'auto'
                    ? 'Rewordings keep the same meaning, brand, links and hashtags — nothing new is added.'
                    : 'This exact text appears on the task with a copy button.'}
                </p>
              </div>
            )}
            {err('generated_content') && <p className="text-[11px] font-bold text-red-600 dark:text-red-400">{err('generated_content')}</p>}
            </>
            )}
            {/* Post image — outside the post-text gate: the image is the
                creative itself, so image-only tasks ("No post text") need
                it just as much. Contributors download it from the task page. */}
            <div>
              <label className="text-xs font-bold text-gray-700 dark:text-gray-300 block mb-1">Post image <span className="font-normal text-gray-400">(optional)</span></label>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">The image contributors download and post. It shows on the task page with a download button.</p>
              <PostImagePicker
                currentUrl={removePostImage ? null : postImageUrl}
                file={postImageFile}
                onFile={(f) => {
                  setPostImageFile(f);
                  if (f) setRemovePostImage(false);
                }}
                onRemoveCurrent={() => setRemovePostImage(true)}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-700 dark:text-gray-300 block mb-2">Required proof</label>
            <div className="flex gap-2 flex-wrap">
              {['Screenshot', 'Screen Recording', 'Link / URL', 'Text Answer'].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => toggleProofRequirement(p)}
                  aria-pressed={proofRequirements.includes(p)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold border-2 transition-all ${
                    proofRequirements.includes(p)
                      ? 'border-[#168BFF] bg-blue-50 dark:bg-blue-500/10 text-[#168BFF]'
                      : 'border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Honest budget preview */}
          <div className="bg-[#F7F9FC] dark:bg-[#0B0F19] border border-[#E7ECF3] dark:border-white/10 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600 dark:text-gray-400">
              <span>
                Task payouts ({contributorCount || 0} × {fmtUsd(rewardCents)})
              </span>
              <span className="font-bold text-gray-900 dark:text-gray-100">{fmtUsd(estimate.tasksBudget)}</span>
            </div>
            <div className="flex justify-between text-gray-600 dark:text-gray-400">
              <span>Platform fee (est. {ESTIMATED_FEE_PERCENT}%)</span>
              <span className="font-bold text-gray-900 dark:text-gray-100">{fmtUsd(estimate.fee)}</span>
            </div>
            <div className="flex justify-between text-base pt-2 border-t border-[#E7ECF3] dark:border-white/10">
              <span className="font-bold text-gray-900 dark:text-gray-100">Estimated total</span>
              <span className="font-extrabold text-[#168BFF]">{fmtUsd(estimate.total)}</span>
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              Estimate only. At launch the server recalculates the fee (currently 15%) and checks your balance
              before holding funds. If funds are insufficient, launch is blocked with a clear message.
              {converted && (
                <>
                  {' '}≈ <span className="notranslate" translate="no">{fmt(estimate.total)}</span> total in{' '}
                  <span className="notranslate" translate="no">{displayCurrency}</span> at today&rsquo;s rate.
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {/* ============ STEP 5: AUDIENCE ============ */}
      {step === 5 && (
        <div className="bg-white dark:bg-[#0C1322] rounded-2xl border border-[#E7ECF3] dark:border-white/10 shadow-xs p-6 space-y-5">
          <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Target audience</h3>
          <div>
            <label className="text-xs font-bold text-gray-700 dark:text-gray-300 block mb-1.5">Target country</label>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#168BFF]/30 focus:border-[#168BFF] bg-white dark:bg-[#0C1322]"
            >
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-700 dark:text-gray-300 block mb-1.5">Minimum contributor level (optional)</label>
            <select
              value={minLevel}
              onChange={(e) => setMinLevel(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#168BFF]/30 focus:border-[#168BFF] bg-white dark:bg-[#0C1322]"
            >
              <option value="">Any level</option>
              {CONTRIBUTOR_LEVELS.map((l) => (
                <option key={l} value={l} className="capitalize">
                  {l}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
              Higher levels restrict the campaign to more experienced contributors.
            </p>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-700 dark:text-gray-300 block mb-1.5">Task duration</label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {[
                { hours: '', label: 'Default' },
                { hours: '24', label: '1 day' },
                { hours: '168', label: '7 days' },
                { hours: '360', label: '15 days' },
                { hours: '720', label: '30 days' },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => setRetentionHours(o.hours)}
                  className={`px-3 py-2.5 rounded-xl text-xs font-bold border transition-colors ${
                    retentionHours === o.hours
                      ? 'bg-[#168BFF] border-[#168BFF] text-white'
                      : 'border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:border-[#168BFF]/50'
                  }`}
                >
                  {o.label}
                </button>
              ))}
              <input
                type="number"
                min={0}
                value={['', '24', '168', '360', '720'].includes(retentionHours) ? '' : retentionHours}
                onChange={(e) => setRetentionHours(e.target.value)}
                placeholder="Hours"
                aria-label="Custom duration in hours"
                className="px-3 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#168BFF]/30 focus:border-[#168BFF]"
              />
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
              The post must stay live this long. Approved rewards wait in the contributor's pending balance; at the end we check the post again — still live → paid, deleted → the reward comes back to you.
            </p>
          </div>
        </div>
      )}

      {/* ============ STEP 6: REVIEW & SUBMIT ============ */}
      {step === 6 && (
        <div className="space-y-5">
          <div className="grid lg:grid-cols-2 gap-5 items-start">
            {/* Live task preview — what contributors will see */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100">What contributors will see</h3>
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  {platform} · {previewVariant.replace(/_/g, ' ')}
                </span>
              </div>
              <TaskPreview task={previewTask} variant={previewVariant} />
              <TaskPreviewSummary task={previewTask} />
            </div>

            {/* Review summary + launch */}
            <div className="bg-white dark:bg-[#0C1322] rounded-2xl border border-[#E7ECF3] dark:border-white/10 shadow-xs p-6 space-y-4 lg:sticky lg:top-6">
              <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Review before launch</h3>
              <dl className="text-sm space-y-2.5">
                {reviewRows.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-gray-50 pb-2">
                    <dt className="text-gray-500 dark:text-gray-400 shrink-0">{k}</dt>
                    <dd className="font-bold text-gray-900 dark:text-gray-100 text-right break-words">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-xl p-3.5 text-xs text-amber-800 dark:text-amber-200">
                <p className="font-bold mb-1">What happens at launch</p>
                <p>
                  The server creates your campaign, calculates the real platform fee, and holds an estimated{' '}
                  {fmtUsd(estimate.total)} from your balance. If your balance is too low, the launch is stopped
                  with a clear funding error — nothing is created and nothing is charged. Once funded, the
                  campaign enters a short review queue and goes live after approval.
                </p>
              </div>

              {launchError && (
                <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4 flex items-start gap-3 text-left">
                  <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-bold text-red-700 dark:text-red-300">Launch failed</p>
                    <p className="text-red-600 dark:text-red-400 mt-1">{launchError}</p>
                    {Object.keys(fieldErrors).length > 0 && (
                      <ul className="text-red-600 dark:text-red-400 mt-2 space-y-1 list-disc list-inside">
                        {Object.entries(fieldErrors).map(([k, msgs]) =>
                          msgs.map((m, i) => (
                            <li key={`${k}-${i}`} className="text-xs">
                              <span className="font-bold">{k}:</span> {m}
                            </li>
                          )),
                        )}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              <button
                type="button"
                disabled={launching || savingDraft || draftLoading}
                onClick={() => void handleSaveDraft()}
                className="w-full px-6 py-3 border-2 border-gray-200 dark:border-white/10 hover:border-[#168BFF] hover:text-[#168BFF] disabled:opacity-50 text-gray-700 dark:text-gray-300 text-sm font-bold rounded-xl transition-colors inline-flex items-center justify-center gap-2"
              >
                {savingDraft ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Saving draft…
                  </>
                ) : (
                  'Save draft & finish later'
                )}
              </button>
              <p className="-mt-2 text-[11px] text-gray-400 dark:text-gray-500 text-center">
                Drafts move no money. Find them under Campaigns → Drafts.
              </p>

              <button
                type="button"
                disabled={launching || savingDraft || draftLoading}
                onClick={() => void handleLaunch()}
                className="w-full px-6 py-3.5 bg-[#168BFF] hover:bg-[#1275DD] disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors inline-flex items-center justify-center gap-2"
              >
                {launching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Launching…
                  </>
                ) : (
                  <>
                    <Rocket className="w-4 h-4" /> Launch Campaign
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Nav buttons */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={back}
          disabled={step === 1 || launching || draftLoading}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-40 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        {step < 6 ? (
          <button
            type="button"
            onClick={next}
            disabled={((categoriesLoading || taskTypesLoading) && step === 3) || launching || draftLoading}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#07182F] hover:bg-[#168BFF] disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors"
          >
            Continue <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <span className="text-[11px] text-gray-400 dark:text-gray-500">Review the preview and summary above, then launch.</span>
        )}
      </div>
    </div>
  );
};
