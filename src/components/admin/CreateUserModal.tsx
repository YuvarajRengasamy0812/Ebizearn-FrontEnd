import React, { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Building2,
  Check,
  Crown,
  Gift,
  Globe,
  Info,
  LayoutDashboard,
  Loader2,
  ShieldCheck,
  User as UserIcon,
  UserCog,
  UserPlus,
  X,
} from 'lucide-react';
import { adminApi, getApiError, getApiFieldErrors } from '../../api';
import type { User } from '../../types';
import { AuthField, authInputClass } from '../auth/AuthSplitLayout';
import { PhoneField } from '../auth/PhoneInput';
import { CountrySelect } from '../auth/CountrySelect';
import { PasswordInput } from '../../pages/auth/PasswordInput';
import { phoneDigits, validatePhone, type PhoneValue } from '../../utils/phone';
import { DEFAULT_DIAL, findCountryDialByDial } from '../../utils/countryDialCodes';
import { INDUSTRIES } from '../../utils/industries';
import { ADMIN_SECTIONS } from '../../utils/permissionGroups';

type CreatableRole = 'contributor' | 'business' | 'moderator' | 'admin' | 'superadmin';
type PermDef = { name: string; label: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRONG_PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,}$/;

const ROLE_META: Record<CreatableRole, { label: string; hint: string; icon: React.ElementType; tone: string }> = {
  contributor: { label: 'Contributor', hint: 'Completes tasks, earns rewards', icon: UserIcon, tone: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-500/10' },
  business: { label: 'Business', hint: 'Runs campaigns, funds tasks', icon: Building2, tone: 'text-violet-600 bg-violet-50 dark:bg-violet-500/10' },
  moderator: { label: 'Moderator', hint: 'Reviews proofs and KYC', icon: ShieldCheck, tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10' },
  admin: { label: 'Admin', hint: 'Runs the admin dashboard', icon: UserCog, tone: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10' },
  superadmin: { label: 'Super Admin', hint: 'Full, unrestricted access', icon: Crown, tone: 'text-rose-600 bg-rose-50 dark:bg-rose-500/10' },
};

/**
 * Fallback for roles the signed-in staff member may create, used until the
 * server answers. Mirrors AdminSystemController::creatableRoles.
 */
export const creatableRolesFor = (actor: User | null | undefined): CreatableRole[] => {
  switch (actor?.role) {
    case 'superadmin':
      return ['contributor', 'business', 'moderator', 'admin', 'superadmin'];
    case 'admin':
      return ['contributor', 'business', 'moderator'];
    case 'moderator':
      return ['contributor', 'business'];
    default:
      return [];
  }
};

const isStaffRole = (r: CreatableRole) => r === 'admin' || r === 'moderator';

const SectionTitle: React.FC<{ step: number; title: string; sub?: string }> = ({ step, title, sub }) => (
  <div className="flex items-start gap-3 mb-3">
    <span className="w-6 h-6 rounded-full bg-[#07182F] dark:bg-white/15 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
      {step}
    </span>
    <div>
      <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100">{title}</h3>
      {sub && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sub}</p>}
    </div>
  </div>
);

/**
 * Create an account of any allowed role (POST /admin/users, create_users).
 * Same fields as public signup; admin / moderator accounts also get their
 * dashboard access picked here (sidebar pages + actions). The account is
 * created active and verified so it can sign in straight away.
 */
export const CreateUserModal: React.FC<{
  actor: User | null | undefined;
  defaultRole?: string;
  onClose: () => void;
  onCreated: (u: User) => void;
}> = ({ actor, defaultRole, onClose, onCreated }) => {
  const [roles, setRoles] = useState<CreatableRole[]>(() => creatableRolesFor(actor));
  const [role, setRole] = useState<CreatableRole>(() => {
    const list = creatableRolesFor(actor);
    return list.includes(defaultRole as CreatableRole) ? (defaultRole as CreatableRole) : list[0] ?? 'contributor';
  });

  // Account details (same as signup)
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState<PhoneValue>({ dialCode: DEFAULT_DIAL, number: '' });
  const [country, setCountry] = useState('GE');
  const [countryTouched, setCountryTouched] = useState(false);
  const [referral, setReferral] = useState('');
  // Business
  const [company, setCompany] = useState('');
  const [website, setWebsite] = useState('');
  const [industry, setIndustry] = useState(INDUSTRIES[0]);

  // Dashboard access (admin / moderator)
  const [catalog, setCatalog] = useState<PermDef[]>([]);
  const [roleDefaults, setRoleDefaults] = useState<Record<string, string[]>>({});
  const [grantable, setGrantable] = useState<string[] | null>(null);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [access, setAccess] = useState<Set<string>>(new Set());

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    adminApi
      .createUserOptions()
      .then((res) => {
        if (!alive || !res.success) return;
        const list = res.data.roles as CreatableRole[];
        if (list.length) {
          setRoles(list);
          setRole((cur) => (list.includes(cur) ? cur : list[0]));
        }
        setCatalog(res.data.permissions);
        setRoleDefaults(res.data.role_permissions);
        setGrantable(res.data.grantable);
        setOptionsLoaded(true);
      })
      .catch(() => {
        /* Fallback: role defaults apply, no access picker. */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Start every staff role from its Roles & Permissions defaults.
  useEffect(() => {
    if (isStaffRole(role)) setAccess(new Set(roleDefaults[role] ?? []));
  }, [role, roleDefaults]);

  const catalogNames = useMemo(() => new Set(catalog.map((p) => p.name)), [catalog]);
  const labelOf = useMemo(() => new Map(catalog.map((p) => [p.name, p.label])), [catalog]);
  const canGive = (perm: string) => grantable === null || grantable.includes(perm);

  const sections = useMemo(
    () =>
      ADMIN_SECTIONS.map((s) => ({ ...s, perms: s.perms.filter((p) => catalogNames.has(p)) })).filter((s) => s.perms.length > 0),
    [catalogNames],
  );
  const otherPerms = useMemo(() => {
    const placed = new Set(ADMIN_SECTIONS.flatMap((s) => s.perms));
    return catalog.filter((p) => !placed.has(p.name));
  }, [catalog]);

  const togglePerm = (perm: string, on: boolean) =>
    setAccess((prev) => {
      const next = new Set(prev);
      if (on) next.add(perm);
      else next.delete(perm);
      return next;
    });

  const toggleSection = (perms: string[], on: boolean) =>
    setAccess((prev) => {
      const next = new Set(prev);
      perms.forEach((p) => {
        if (on && canGive(p)) next.add(p);
        if (!on) next.delete(p);
      });
      return next;
    });

  const pagesOn = sections.filter((s) => access.has(s.perms[0])).length;
  const isBusiness = role === 'business';
  const needsPhone = role === 'contributor' || role === 'business';
  const showAccess = isStaffRole(role) && optionsLoaded;

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = 'Enter the full name.';
    if (!EMAIL_RE.test(email.trim())) errs.email = 'Enter a valid email address.';
    if (!STRONG_PASSWORD_RE.test(password)) errs.password = 'Use 10+ characters with uppercase, lowercase, number and symbol.';
    if (needsPhone || phone.number.trim()) {
      const phoneErr = validatePhone(phone);
      if (phoneErr) errs.phone = phoneErr;
    }
    if (isBusiness && !company.trim()) errs.company_name = 'Enter the company name.';
    if (isBusiness && website.trim() && !/^https?:\/\/.+\..+/.test(website.trim())) errs.website = 'Start with https://';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const save = async () => {
    setError(null);
    if (!validate()) return;
    setSaving(true);
    try {
      const hasPhone = phoneDigits(phone.number).length > 0;
      const res = await adminApi.createUser({
        role,
        name: name.trim(),
        email: email.trim(),
        password,
        country_code: country,
        ...(hasPhone ? { phone_country_code: phone.dialCode, phone_number: phoneDigits(phone.number) } : {}),
        ...(needsPhone && referral.trim() ? { referral_code: referral.trim() } : {}),
        ...(isBusiness ? { company_name: company.trim(), website: website.trim() || undefined, industry } : {}),
        ...(showAccess ? { permissions: Array.from(access) } : {}),
      });
      if (res.success && res.data) {
        onCreated(res.data);
        onClose();
      } else {
        setError(res.message || 'Could not create the account.');
      }
    } catch (e) {
      const apiFields = getApiFieldErrors(e);
      const mapped: Record<string, string> = {};
      Object.entries(apiFields).forEach(([k, v]) => {
        const key = k.startsWith('phone') ? 'phone' : k;
        if (!mapped[key]) mapped[key] = v;
      });
      setFieldErrors(mapped);
      setError(getApiError(e, 'Could not create the account.'));
    } finally {
      setSaving(false);
    }
  };

  const meta = ROLE_META[role];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Create user">
      <div className="absolute inset-0 bg-[#07182F]/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[92vh] flex flex-col bg-white dark:bg-[#0F1522] rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 dark:border-white/10 flex items-start justify-between gap-4 bg-gradient-to-r from-[#F3F8FF] to-white dark:from-[#101A2E] dark:to-[#0F1522]">
          <div className="flex items-start gap-3">
            <span className="w-11 h-11 rounded-2xl bg-[#168BFF] text-white flex items-center justify-center shadow-lg shadow-[#168BFF]/25 shrink-0">
              <UserPlus className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-lg font-extrabold text-gray-900 dark:text-gray-100">Create user</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                The account is active and email-verified. It can sign in right away with this email and password.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          id="create-user-form"
          className="flex-1 overflow-y-auto px-6 py-6 space-y-8"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {/* 1. Account type */}
          <section>
            <SectionTitle step={1} title="Account type" sub="Choose what this person can do on the platform." />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
              {roles.map((r) => {
                const m = ROLE_META[r];
                const Icon = m.icon;
                const active = role === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setRole(r);
                      setFieldErrors({});
                    }}
                    className={`relative text-left rounded-2xl border p-3 transition-all ${
                      active
                        ? 'border-[#168BFF] ring-4 ring-[#168BFF]/12 bg-[#F3F8FF] dark:bg-[#168BFF]/10'
                        : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'
                    }`}
                  >
                    {active && (
                      <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-[#168BFF] text-white flex items-center justify-center">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                    <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${m.tone}`}>
                      <Icon className="w-4 h-4" />
                    </span>
                    <p className="mt-2 text-[13px] font-bold text-gray-900 dark:text-gray-100">{m.label}</p>
                    <p className="text-[11px] leading-snug text-gray-500 dark:text-gray-400">{m.hint}</p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2. Details */}
          <section>
            <SectionTitle
              step={2}
              title={isBusiness ? 'Business & owner details' : 'Personal details'}
              sub={isBusiness ? 'Same details a business gives when signing up.' : 'Same details asked on the signup page.'}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {isBusiness && (
                <>
                  <AuthField id="cu-company" label="Company name" error={fieldErrors.company_name}>
                    <div className="relative">
                      <Briefcase className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="cu-company"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        placeholder="e.g. eBiz Network"
                        maxLength={255}
                        className={`${authInputClass} ps-10`}
                      />
                    </div>
                  </AuthField>
                  <AuthField id="cu-industry" label="Industry">
                    <select id="cu-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} className={authInputClass}>
                      {INDUSTRIES.map((i) => (
                        <option key={i} value={i}>
                          {i}
                        </option>
                      ))}
                    </select>
                  </AuthField>
                </>
              )}

              <AuthField id="cu-name" label={isBusiness ? 'Owner full name' : 'Full name'} error={fieldErrors.name}>
                <input
                  id="cu-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Sarah Jenkins"
                  maxLength={255}
                  autoComplete="off"
                  className={authInputClass}
                />
              </AuthField>
              <AuthField id="cu-email" label={isBusiness ? 'Work email (login)' : 'Email address (login)'} error={fieldErrors.email}>
                <input
                  id="cu-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={isBusiness ? 'alex@company.com' : 'sarah@example.com'}
                  maxLength={255}
                  autoComplete="off"
                  inputMode="email"
                  className={authInputClass}
                />
              </AuthField>

              <div className="sm:col-span-2">
                <AuthField
                  id="cu-password"
                  label="Password"
                  error={fieldErrors.password}
                  hint={password ? undefined : '10+ characters with uppercase, lowercase, number and symbol.'}
                >
                  <PasswordInput
                    id="cu-password"
                    value={password}
                    onChange={setPassword}
                    placeholder="Create a password"
                    minLength={10}
                    autoComplete="new-password"
                    large
                    showStrength
                  />
                </AuthField>
              </div>

              <div className="sm:col-span-2">
                <PhoneField
                  id="cu-phone"
                  label={needsPhone ? 'Phone number' : 'Phone number (optional)'}
                  value={phone}
                  onChange={(v) => {
                    setPhone(v);
                    if (!countryTouched) {
                      const match = findCountryDialByDial(v.dialCode);
                      if (match) setCountry(match.iso);
                    }
                  }}
                  error={fieldErrors.phone || undefined}
                />
              </div>

              <AuthField id="cu-country" label="Country">
                <CountrySelect
                  id="cu-country"
                  value={country}
                  onChange={(iso) => {
                    setCountry(iso);
                    setCountryTouched(true);
                  }}
                />
              </AuthField>

              {isBusiness ? (
                <AuthField id="cu-website" label="Website (optional)" error={fieldErrors.website}>
                  <div className="relative">
                    <Globe className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="cu-website"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="https://company.com"
                      maxLength={255}
                      className={`${authInputClass} ps-10`}
                    />
                  </div>
                </AuthField>
              ) : needsPhone ? (
                <AuthField id="cu-referral" label="Referral code (optional)" error={fieldErrors.referral_code}>
                  <div className="relative">
                    <Gift className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="cu-referral"
                      value={referral}
                      onChange={(e) => setReferral(e.target.value)}
                      placeholder="e.g. AB12CD34"
                      autoComplete="off"
                      className={`${authInputClass} ps-10 uppercase placeholder:normal-case`}
                    />
                  </div>
                </AuthField>
              ) : null}

              {isBusiness && (
                <div className="sm:col-span-2">
                  <AuthField id="cu-referral" label="Referral code (optional)" error={fieldErrors.referral_code}>
                    <div className="relative">
                      <Gift className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="cu-referral"
                        value={referral}
                        onChange={(e) => setReferral(e.target.value)}
                        placeholder="e.g. AB12CD34"
                        autoComplete="off"
                        className={`${authInputClass} ps-10 uppercase placeholder:normal-case`}
                      />
                    </div>
                  </AuthField>
                </div>
              )}
            </div>
          </section>

          {/* 3. Dashboard access */}
          {showAccess && (
            <section>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <SectionTitle
                  step={3}
                  title="Dashboard access"
                  sub={`Pick which admin dashboard pages this ${meta.label.toLowerCase()} can open, and what they can do there.`}
                />
                <div className="flex items-center gap-3 text-[11px] font-bold">
                  <span className="px-2.5 py-1 rounded-full bg-[#168BFF]/10 text-[#168BFF]">
                    {pagesOn} / {sections.length} pages
                  </span>
                  <button
                    type="button"
                    onClick={() => setAccess(new Set(catalog.map((p) => p.name).filter(canGive)))}
                    className="text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    Select all
                  </button>
                  <button type="button" onClick={() => setAccess(new Set(roleDefaults[role] ?? []))} className="text-gray-500 dark:text-gray-400 hover:underline">
                    Role default
                  </button>
                  <button type="button" onClick={() => setAccess(new Set())} className="text-red-600 dark:text-red-400 hover:underline">
                    Clear
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {sections.map((s) => {
                  const page = s.perms[0];
                  const on = access.has(page);
                  const pageGivable = canGive(page) || on;
                  const actions = s.perms.slice(1);
                  return (
                    <div
                      key={s.path}
                      className={`rounded-2xl border p-3 transition-colors ${
                        on ? 'border-[#168BFF]/40 bg-[#F3F8FF] dark:bg-[#168BFF]/10' : 'border-gray-200 dark:border-white/10'
                      }`}
                    >
                      <label className={`flex items-center justify-between gap-3 ${pageGivable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                        <span className="flex items-center gap-2 min-w-0">
                          <LayoutDashboard className={`w-4 h-4 shrink-0 ${on ? 'text-[#168BFF]' : 'text-gray-400'}`} />
                          <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100 truncate">{s.label}</span>
                        </span>
                        <span className="relative inline-flex shrink-0">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={on}
                            disabled={!pageGivable}
                            onChange={(e) => toggleSection(s.perms, e.target.checked)}
                          />
                          <span className="w-9 h-5 rounded-full bg-gray-200 dark:bg-white/15 peer-checked:bg-[#168BFF] transition-colors" />
                          <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
                        </span>
                      </label>
                      {on && actions.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {actions.map((p) => {
                            const has = access.has(p);
                            const givable = canGive(p) || has;
                            return (
                              <button
                                key={p}
                                type="button"
                                disabled={!givable}
                                title={givable ? undefined : "You can't give a permission you don't have yourself"}
                                onClick={() => togglePerm(p, !has)}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                  has
                                    ? 'bg-[#168BFF] border-[#168BFF] text-white'
                                    : 'bg-white dark:bg-transparent border-gray-200 dark:border-white/15 text-gray-600 dark:text-gray-300 hover:border-[#168BFF]'
                                }`}
                              >
                                {has && <Check className="w-3 h-3" />}
                                {labelOf.get(p) ?? p}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {otherPerms.length > 0 && (
                <div className="mt-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">Other permissions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {otherPerms.map((p) => {
                      const has = access.has(p.name);
                      const givable = canGive(p.name) || has;
                      return (
                        <button
                          key={p.name}
                          type="button"
                          disabled={!givable}
                          onClick={() => togglePerm(p.name, !has)}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors disabled:opacity-40 ${
                            has
                              ? 'bg-[#168BFF] border-[#168BFF] text-white'
                              : 'bg-white dark:bg-transparent border-gray-200 dark:border-white/15 text-gray-600 dark:text-gray-300 hover:border-[#168BFF]'
                          }`}
                        >
                          {has && <Check className="w-3 h-3" />}
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          {role === 'superadmin' && (
            <div className="flex items-start gap-2.5 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 rounded-2xl px-4 py-3 text-xs text-rose-900 dark:text-rose-200">
              <Crown className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" />
              <p>
                A Super Admin has <b>full, unrestricted access</b> to every page and setting, including creating other admins. Create one only for
                someone you fully trust.
              </p>
            </div>
          )}

          {!isStaffRole(role) && role !== 'superadmin' && (
            <div className="flex items-start gap-2.5 bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/25 rounded-2xl px-4 py-3 text-xs text-blue-900 dark:text-blue-200">
              <Info className="w-4 h-4 mt-0.5 shrink-0 text-[#168BFF]" />
              <p>
                {isBusiness
                  ? 'The owner signs in to the business portal with this email and password. Business permissions come from Roles & Permissions.'
                  : 'The contributor signs in with this email and password and can change the password later.'}{' '}
                Share the password securely.
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-sm font-medium rounded-2xl px-4 py-3">
              {error}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-white/10 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 bg-gray-50/60 dark:bg-white/[0.02]">
          <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
            <span className={`w-5 h-5 rounded-lg flex items-center justify-center ${meta.tone}`}>
              <meta.icon className="w-3 h-3" />
            </span>
            Creating a <b className="text-gray-700 dark:text-gray-200">{meta.label}</b> account
            {showAccess && <> with {pagesOn} dashboard page{pagesOn === 1 ? '' : 's'}</>}
          </p>
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-user-form"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-[#168BFF] hover:bg-[#0f7ae5] shadow-lg shadow-[#168BFF]/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Create {meta.label}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
