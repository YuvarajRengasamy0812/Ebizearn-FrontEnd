import { api } from './client';
import type { AdminUserDetail, Campaign, CampaignEditInput, ReferralRule, ReferralRuleInput, ReferralRulesResponse, AuditLog, FeatureFlag, FraudEvent, Task, TaskSubmission, User, WithdrawalRequest } from '../types';

export interface StaffTaskCampaignOption {
  id: number;
  title: string;
  status: Campaign['status'];
  platform: string | null;
  instructions_markdown: string | null;
  pool_cents: number;
  business_name: string | null;
}

export interface StaffBusinessOption {
  id: number;
  company_name: string;
  owner_name: string | null;
  available_balance_cents: number;
}

export const adminApi = {
  dashboard: () => api.get('/admin/dashboard').then((r) => r.data),
  traffic: (params?: { from?: string; to?: string }) =>
    api.get('/admin/traffic', { params }).then((r) => r.data),
  trafficSession: (sessionId: string) =>
    api.get(`/admin/traffic/sessions/${sessionId}`).then((r) => r.data),
  verificationQueue: (params?: { status?: string; search?: string; business_decision?: 'approved' | 'rejected' | 'none' }) =>
    api.get('/admin/verification-queue', { params }).then((r) => r.data as { success: boolean; message?: string; data: TaskSubmission[]; meta?: unknown }),
  submissionDetail: (submissionId: number | string) =>
    api.get(`/admin/submissions/${submissionId}`).then((r) => r.data as { success: boolean; data: TaskSubmission }),
  recordDecision: (submissionId: number | string, payload: { decision: string; reason_code: string; notes?: string }) =>
    api.post(`/admin/submissions/${submissionId}/decision`, payload).then((r) => r.data),
  submissionAppeals: (params?: { status?: 'open' | 'upheld' | 'denied' }) =>
    api.get('/admin/submission-appeals', { params }).then((r) => r.data as {
      success: boolean; message?: string;
      data: { id: number; uuid: string; submission_id: number; reason: string; status: 'open' | 'upheld' | 'denied'; created_at: string; review_notes: string | null; submission?: { id: number; task?: { title: string } }; user?: { name: string; profile?: { display_name?: string } } }[];
      meta?: { current_page: number; last_page: number; total: number };
    }),
  decideAppeal: (appealId: number | string, payload: { decision: 'uphold' | 'deny'; notes?: string }) =>
    api.post(`/admin/submission-appeals/${appealId}/decision`, payload).then((r) => r.data),
  fraudAlerts: () => api.get('/admin/fraud-alerts').then((r) => r.data as { success: boolean; message?: string; data: FraudEvent[]; meta?: unknown }),
  payouts: (params?: { status?: string }) =>
    api.get('/admin/payouts', { params }).then((r) => r.data as { success: boolean; message?: string; data: WithdrawalRequest[]; meta?: unknown }),
  processPayout: (payoutId: number | string, payload: { action: 'approve' | 'reject'; reason?: string; provider_tx_id?: string }) =>
    api.post(`/admin/payouts/${payoutId}/process`, payload).then((r) => r.data as { success: boolean; message?: string; data: WithdrawalRequest }),
  featureFlags: () => api.get('/admin/feature-flags').then((r) => r.data as { success: boolean; data: FeatureFlag[] }),
  updateFeatureFlag: (key: string, is_enabled: boolean) =>
    api.patch(`/admin/feature-flags/${key}`, { is_enabled }).then((r) => r.data as { success: boolean; data: FeatureFlag }),
  systemSettings: () => api.get('/admin/system-settings').then((r) => r.data),
  updateSystemSetting: (key: string, value: unknown) =>
    api.patch('/admin/system-settings', { key, value }).then((r) => r.data),
  auditLogs: () => api.get('/admin/audit-logs').then((r) => r.data as { success: boolean; message?: string; data: AuditLog[]; meta?: unknown }),
  users: (params?: { role?: string; search?: string; page?: number }) =>
    api.get('/admin/users', { params }).then(
      (r) =>
        r.data as {
          success: boolean;
          message?: string;
          data: User[];
          meta?: { current_page: number; last_page: number; total: number };
        },
    ),
  userDetail: (userId: number | string) =>
    api.get(`/admin/users/${userId}`).then((r) => r.data as { success: boolean; message?: string; data: AdminUserDetail }),
  updateUserStatus: (userId: number | string, status: 'active' | 'suspended' | 'pending_verification') =>
    api.patch(`/admin/users/${userId}/status`, { status }).then((r) => r.data as { success: boolean; message?: string; data: User }),
  updateUser: (userId: number | string, payload: { name?: string; email?: string; company_name?: string; industry?: string; website?: string; phone?: string; country_code?: string }) =>
    api.patch(`/admin/users/${userId}`, payload).then((r) => r.data as { success: boolean; message?: string; data: User }),
  impersonate: (userId: number | string) =>
    api.post(`/admin/users/${userId}/impersonate`, {}).then((r) => r.data as { success: boolean; message?: string; data: { token: string } }),
  health: () => api.get('/admin/health').then((r) => r.data),
  paymentGateways: () => api.get('/admin/payments/gateways').then((r) => r.data),
  createPaymentGateway: (payload: unknown) => api.post('/admin/payments/gateways', payload).then((r) => r.data),
  updatePaymentGateway: (id: number | string, payload: unknown) => api.put(`/admin/payments/gateways/${id}`, payload).then((r) => r.data),
  deletePaymentGateway: (id: number | string) => api.delete(`/admin/payments/gateways/${id}`).then((r) => r.data),
  setPaymentGatewayActive: (id: number | string, is_active: boolean) =>
    api.post(`/admin/payments/gateways/${id}/active`, { is_active }).then((r) => r.data),
  testPaymentGateway: (id: number | string) => api.post(`/admin/payments/gateways/${id}/test`).then((r) => r.data),
  paymentLogs: () => api.get('/admin/payments/logs').then((r) => r.data),
  // Phase 11: staff campaign oversight (GET /staff/campaigns). Paginated by
  // the backend; returns { data: { data: Campaign[], ... } } (Laravel pager).
  staffCampaigns: (params?: { status?: string; search?: string; business_id?: number; per_page?: number; page?: number }) =>
    api.get('/staff/campaigns', { params }).then((r) => r.data),
  // Staff-created campaign: admin posts a campaign on behalf of a business
  // (POST /staff/campaigns). Same pipeline as the business portal.
  createStaffCampaign: (payload: {
    business_id: number;
    title: string;
    objective?: string;
    description: string;
    category_id: number;
    platform?: string;
    target_url?: string;
    reward_per_task_cents: number;
    task_type_key: string;
    target_contributors_count: number;
    instructions_markdown: string;
    proof_requirements_json?: string[];
    target_countries?: string[];
    target_languages?: string[];
    min_contributor_level?: string;
    retention_hours?: number;
  }) => api.post('/staff/campaigns', payload).then((r) => r.data),
  updateStaffCampaignStatus: (id: number | string, status: 'active' | 'paused' | 'cancelled') =>
    api.patch(`/staff/campaigns/${id}/status`, { status }).then((r) => r.data),
  // GET /staff/campaigns/{id}: campaign + business + tasks + spent_cents.
  staffCampaign: (id: number | string) =>
    api.get(`/staff/campaigns/${id}`).then((r) => r.data as { success: boolean; message?: string; data: Campaign & { spent_cents: number } }),
  // Edit copy / targeting only (edit_campaigns). Money fields are not editable.
  updateStaffCampaign: (id: number | string, payload: CampaignEditInput) =>
    api.patch(`/staff/campaigns/${id}`, payload).then((r) => r.data as { success: boolean; message?: string; data: Campaign }),
  // Post content: staff override (edit_campaigns) — saved text is approved.
  updateCampaignContent: (
    id: number | string,
    payload: { content_mode: 'manual' | 'auto' | null; generated_content?: string; content_brief?: string | null },
  ) => api.patch(`/staff/campaigns/${id}/content`, payload).then((r) => r.data as { success: boolean; message?: string; data: Campaign }),
  // Post image (staff): replace / remove — staff changes are approved.
  uploadCampaignContentImage: (id: number | string, file: File) => {
    const body = new FormData();
    body.append('image', file);
    return api
      .post(`/staff/campaigns/${id}/content-image`, body, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data as { success: boolean; message?: string; data: { content_image_url: string | null; content_status: string | null } });
  },
  removeCampaignContentImage: (id: number | string) =>
    api
      .delete(`/staff/campaigns/${id}/content-image`)
      .then((r) => r.data as { success: boolean; message?: string; data: { content_image_url: string | null; content_status: string | null } }),
  // Approve / reject post content (tasks show only once approved).
  campaignContentDecision: (id: number | string, decision: 'approve' | 'reject', note?: string) =>
    api
      .post(`/staff/campaigns/${id}/content/decision`, { decision, note })
      .then((r) => r.data as { success: boolean; message?: string; data: Campaign }),
  // Contributor level: set by hand + lock, or follow completed tasks.
  setContributorLevel: (userId: number, level: string, locked: boolean) =>
    api
      .patch(`/admin/users/${userId}/level`, { level, locked })
      .then((r) => r.data as { success: boolean; message?: string; data: { level: string; locked: boolean } }),
  // Safe delete (delete_campaigns): refused once contributors worked on it;
  // outstanding escrow goes back to the business wallet first.
  deleteStaffCampaign: (id: number | string) =>
    api.delete(`/staff/campaigns/${id}`).then((r) => r.data as { success: boolean; message?: string; data?: { escrow_released_cents: number } }),
  // Staff task CRUD (manage_task_templates). Paginated 20/page.
  staffTasks: (params?: { campaign_id?: number; status?: string; page?: number }) =>
    api.get('/staff/tasks', { params }).then((r) => r.data as {
      success: boolean;
      message?: string;
      data: Task[];
      meta?: { current_page: number; last_page: number; total: number };
    }),
  createStaffTask: (payload: {
    campaign_id: number;
    task_type_key: string;
    title: string;
    reward_cents: number;
    slots_total: number;
    instructions?: string;
    platform?: string;
    estimated_minutes?: number;
    difficulty?: 'easy' | 'medium' | 'hard';
  }) => api.post('/staff/tasks', payload).then((r) => r.data as { success: boolean; message?: string; data: Task }),
  // Campaigns a task can be added to (create_tasks; no campaign access needed).
  staffTaskCampaignOptions: () =>
    api.get('/staff/tasks/campaign-options').then((r) => r.data as { success: boolean; message?: string; data: StaffTaskCampaignOption[] }),
  // Businesses a campaign can be posted for (post_campaigns; no manage_users needed).
  staffBusinessOptions: () =>
    api.get('/staff/campaigns/business-options').then((r) => r.data as { success: boolean; message?: string; data: StaffBusinessOption[] }),
  // Create a business user account (create_business_users). Role is fixed server-side.
  // Create a user of any allowed role from Users & KYC (create_users).
  createUser: (payload: {
    role: 'contributor' | 'business' | 'moderator' | 'admin' | 'superadmin';
    name: string;
    email: string;
    password: string;
    company_name?: string;
    website?: string;
    industry?: string;
    country_code?: string;
  }) => api.post('/admin/users', payload).then((r) => r.data as { success: boolean; message?: string; data: User }),
  createBusinessUser: (payload: { name: string; email: string; password: string; company_name: string; website?: string; industry?: string; country_code?: string }) =>
    api.post('/admin/businesses', payload).then((r) => r.data as { success: boolean; message?: string; data: User }),
  // Restore the canonical task-type catalog when the table is empty (superadmin).
  seedTaskTypes: () =>
    api.post('/ops/task-types/seed').then((r) => r.data as { success: boolean; message?: string; data: { created: number; updated: number; total: number } }),
  updateStaffTask: (id: number | string, payload: Record<string, unknown>) =>
    api.patch(`/staff/tasks/${id}`, payload).then((r) => r.data as { success: boolean; message?: string; data: Task }),
  deleteStaffTask: (id: number | string) =>
    api.delete(`/staff/tasks/${id}`).then((r) => r.data as { success: boolean; message?: string }),
  // Phase 11: platform-wide referral overview (read-only aggregate).
  referralOverview: () =>
    api.get('/admin/referrals/overview').then((r) => r.data),
  // Referral commissions per level (L1/L2/L3). Editing needs
  // manage_referral_rules (Super Admin, or an admin they grant it to).
  referralRules: () =>
    api.get('/admin/referral-rules').then((r) => r.data as { success: boolean; message?: string; data: ReferralRulesResponse }),
  updateReferralRules: (levels: ReferralRuleInput[]) =>
    api
      .patch('/admin/referral-rules', { levels })
      .then((r) => r.data as { success: boolean; message?: string; data: { rules: ReferralRule[] } }),
  // Demo requests inbox (GET /admin/demo-requests, paginated latest-first).
  demoRequests: (params?: { per_page?: number; page?: number }) =>
    api.get('/admin/demo-requests', { params }).then((r) => r.data as {
      success: boolean;
      message?: string;
      data: { id: number; name: string; email: string; company: string; message: string; status: string; created_at: string }[];
      meta?: { total: number };
    }),
};
