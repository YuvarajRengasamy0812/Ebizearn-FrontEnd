import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  CheckCircle2,
  Gift,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { authApi, getApiError, getApiFieldErrors } from '../../api';
import {
  AuthSplitLayout,
  AuthBadge,
  AuthField,
  AuthError,
  AuthSubmitButton,
  authInputClass,
} from '../../components/auth/AuthSplitLayout';
import { SocialLoginButtons } from '../../components/auth/SocialLoginButtons';
import { TermsConsentCheckbox, TermsConsentModal } from '../../components/auth/TermsConsent';
import { readStoredConsent, type TermsConsent } from '../../utils/termsConsent';
import { PasswordInput } from './PasswordInput';
import {
  PhoneField,
} from '../../components/auth/PhoneInput';
import { phoneDigits, validatePhone, type PhoneValue } from '../../utils/phone';
import { DEFAULT_DIAL, findCountryDialByDial, findCountryDialByIso } from '../../utils/countryDialCodes';
import { detectVisitorCountry } from '../../utils/visitorCountry';
import { CountrySelect } from '../../components/auth/CountrySelect';
import { setPendingOtpEmail } from '../../utils/pendingAuth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRONG_PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,}$/;

export const ContributorSignupPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const refCodeFromUrl = searchParams.get('ref') || '';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('GE');
  /** Once the user picks a country, the phone code no longer changes it. */
  const [countryTouched, setCountryTouched] = useState(false);
  const [phone, setPhone] = useState<PhoneValue>({ dialCode: DEFAULT_DIAL, number: '' });
  /** Has the user picked a country / dial code themselves? The IP default
      below must never overwrite their choice. */
  const userPickedCountryRef = useRef(false);

  /* Default country + phone dial from the visitor's IP location (a visitor
     in Dubai sees UAE +971, not Georgia +995). Runs once on mount; only
     applies while the user hasn't touched country or dial, and only while
     the phone number is still empty. */
  useEffect(() => {
    let cancelled = false;
    void detectVisitorCountry().then((iso) => {
      if (cancelled || !iso || userPickedCountryRef.current) return;
      const match = findCountryDialByIso(iso);
      if (!match) return;
      setCountry(match.iso);
      setPhone((prev) => (prev.number === '' ? { dialCode: match.dial, number: '' } : prev));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [referralCode, setReferralCode] = useState(refCodeFromUrl);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  // Terms consent: accepted only through the modal's "I agree and
  // acknowledge" button. The Sign Up button stays disabled until accepted.
  const [consent, setConsent] = useState<TermsConsent | null>(() => readStoredConsent());
  const [consentModalOpen, setConsentModalOpen] = useState(false);

  const acceptConsent = (c: TermsConsent) => {
    setConsent(c);
    setConsentModalOpen(false);
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = 'Enter your full name.';
    if (!EMAIL_RE.test(email.trim())) errs.email = 'Enter a valid email address.';
    if (!STRONG_PASSWORD_RE.test(password)) {
      errs.password = 'Use 10+ characters with uppercase, lowercase, number, and symbol.';
    }
    const phoneErr = validatePhone(phone);
    if (phoneErr) errs.phone = phoneErr;
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // Defense in depth: the submit button is disabled without consent, but
    // never let the request out without proof of acceptance.
    if (!consent) {
      setError('Please review and accept the Terms of Service to create your account.');
      return;
    }
    if (!validate()) return;
    setSubmitting(true);

    try {
      // IMPORTANT: per the OTP contract the account is created unverified
      // with NO session token — so call authApi directly and do NOT persist
      // anything here. The token arrives later from otp/verify.
      const res = await authApi.register({
        name: name.trim(),
        email: email.trim(),
        password,
        role: 'contributor',
        country_code: country,
        referral_code: referralCode.trim() || undefined,
        phone_country_code: phone.dialCode,
        phone_number: phoneDigits(phone.number),
        terms_version: consent.version,
        terms_accepted_at: consent.acceptedAt,
      });

      if (!res.success || !res.data?.user) {
        setSubmitting(false);
        setError(res.message || 'Could not create your account. Please check the form and try again.');
        return;
      }

      // The backend sends the first OTP email itself inside the register
      // transaction — no otp/send call here (that would deliver a second
      // email). Hand off to the code-entry step; resends go through the
      // VerifyOtpPage "Resend code" button.
      setPendingOtpEmail(email.trim(), 'contributor');
      setSubmitting(false);
      navigate('/verify-otp', { replace: true });
    } catch (err) {
      setSubmitting(false);
      // Put server-side field errors (e.g. "email already taken") under the
      // right input, and show the summary as a toast.
      const apiFields = getApiFieldErrors(err);
      const mapped: Record<string, string> = {};
      Object.entries(apiFields).forEach(([k, v]) => {
        const key = k.startsWith('phone') ? 'phone' : k === 'referral_code' ? 'referral' : k;
        if (!mapped[key]) mapped[key] = v;
      });
      setFieldErrors(mapped);
      setError(getApiError(err, 'Could not create your account. Please check the form and try again.'));
    }
  };

  return (
    <AuthSplitLayout
      image="/images/auth/contributor-login.webp"
      imageAlt="New contributor starting to earn from verified tasks"
      badge={
        <AuthBadge icon={<BadgeCheck className="w-3.5 h-3.5" />} label="Contributor registration" />
      }
      headline={
        <>
          Start earning in{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#20C4E8] to-[#168BFF]">under 60 seconds.</span>
        </>
      }
      subtext="Free forever — no fees, no deposits. Complete verified tasks and withdraw real cash."
      accentClass="text-[#20C4E8]"
      bullets={[
        { icon: ShieldCheck, title: 'Verified campaigns', text: 'Every task comes from a real, reviewed business.' },
        { icon: Banknote, title: 'Real cash payouts', text: 'Withdraw to your bank from $50.' },
        { icon: Sparkles, title: 'Free forever', text: 'No fees, no deposits, no upgrades.' },
      ]}
    >
      <div className="mb-5 short:mb-2 flex flex-col items-center text-center">
        <span className="short:hidden inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/25 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="w-3.5 h-3.5" /> 100% free — no fees, no deposits, ever
        </span>
        <h2 className="mt-3 short:mt-0 text-[26px] short:text-[23px] leading-tight font-extrabold tracking-[-0.02em] text-[#07182F] dark:text-gray-100">
          Create your{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#168BFF] to-[#7257FF]">free account</span>
        </h2>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-gray-400 short:hidden">Start earning from verified digital tasks today.</p>
      </div>

      {error && <AuthError message={error} />}

      <form onSubmit={handleSignup} className="space-y-3 short:space-y-2" noValidate>
        <AuthField id="name" label="Full name" error={fieldErrors.name}>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sarah Jenkins"
            autoComplete="name"
            className={authInputClass}
          />
        </AuthField>

        <AuthField id="email" label="Email address" error={fieldErrors.email}>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="sarah@example.com"
            autoComplete="email"
            inputMode="email"
            className={authInputClass}
          />
        </AuthField>

        <AuthField
          id="password"
          label="Password"
          error={fieldErrors.password}
          hint={password ? undefined : '10+ characters with uppercase, lowercase, number and symbol.'}
        >
          <PasswordInput
            id="password"
            value={password}
            onChange={setPassword}
            placeholder="Create a password"
            minLength={10}
            autoComplete="new-password"
            large
            showStrength
          />
        </AuthField>

        <PhoneField
          id="phone"
          label="Phone number"
          value={phone}
          onChange={(v) => {
            if (v.dialCode !== phone.dialCode) userPickedCountryRef.current = true;
            setPhone(v);
            if (!countryTouched) {
              const match = findCountryDialByDial(v.dialCode);
              if (match) setCountry(match.iso);
            }
            if (fieldErrors.phone) {
              const next = { ...fieldErrors };
              const err = validatePhone(v);
              if (err) next.phone = err;
              else delete next.phone;
              setFieldErrors(next);
            }
          }}
          error={fieldErrors.phone || undefined}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <AuthField id="country" label="Country">
            <CountrySelect
              id="country"
              value={country}
              onChange={(iso) => {
                userPickedCountryRef.current = true;
                setCountry(iso);
                setCountryTouched(true);
              }}
            />
          </AuthField>

          <AuthField id="referral" label="Referral code (optional)" error={fieldErrors.referral}>
            <div className="relative">
              <Gift className="w-4 h-4 text-slate-400 dark:text-gray-500 absolute start-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="referral"
                type="text"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value)}
                placeholder="e.g. AB12CD34"
                autoComplete="off"
                className={`${authInputClass} ps-10 uppercase placeholder:normal-case`}
              />
            </div>
          </AuthField>
        </div>

        <TermsConsentCheckbox
          consent={consent}
          onAccept={acceptConsent}
          onRevoke={() => setConsent(null)}
        />

        <AuthSubmitButton
          loading={submitting}
          loadingLabel="Creating your account…"
          disabled={!consent}
          disabledLabel="Review and accept the Terms of Service first"
        >
          <span>Create free account</span>
          <ArrowRight className="w-4 h-4 rtl:rotate-180" />
        </AuthSubmitButton>
      </form>

      <SocialLoginButtons
        portal="contributor"
        mode="register"
        dividerLabel="or"
        dividerClassName="my-4 short:my-2.5"
        termsGate={{ consent, onRequestConsent: () => setConsentModalOpen(true) }}
      />

      {consentModalOpen && (
        <TermsConsentModal onAccept={acceptConsent} onClose={() => setConsentModalOpen(false)} />
      )}

      <p className="mt-4 short:mt-2.5 text-center text-sm text-slate-500 dark:text-gray-400">
        Already have an account?{' '}
        <Link to="/login" className="text-[#168BFF] font-bold hover:underline">
          Sign in
        </Link>
      </p>
    </AuthSplitLayout>
  );
};
