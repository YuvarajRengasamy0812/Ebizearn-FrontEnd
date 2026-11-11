import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from '../../utils/toast';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import type { LoginPortal } from '../../api';
import { authApi } from '../../api';
import { AppleLogo, GoogleLogo } from '../common/PlatformIcons';
import { navigateAfterLogin, stateFrom } from './EmailVerification';
import { setPendingPhoneRole } from '../../utils/pendingAuth';
import { useAuthProviders } from '../../utils/useAuthProviders';
import type { TermsAcceptance } from '../../api';
import type { TermsConsent } from '../../utils/termsConsent';

/* ------------------------------------------------------------------ */
/* Script loading                                                      */
/* ------------------------------------------------------------------ */

const loadedScripts = new Map<string, Promise<void>>();

/** GIS must be initialize()d once per page; the callback forwards here. */
let initializedClientId: string | null = null;
let activeCredentialHandler: ((response: GsiCredentialResponse) => void) | null = null;

function loadScript(src: string): Promise<void> {
  if (!loadedScripts.has(src)) {
    loadedScripts.set(
      src,
      new Promise<void>((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.async = true;
        el.defer = true;
        el.onload = () => resolve();
        el.onerror = () => {
          loadedScripts.delete(src);
          reject(new Error(`Could not load ${src}`));
        };
        document.head.appendChild(el);
      })
    );
  }
  return loadedScripts.get(src)!;
}

/* ------------------------------------------------------------------ */
/* Minimal vendor-SDK typings (no `any` so lint stays clean)           */
/* ------------------------------------------------------------------ */

interface GsiCredentialResponse {
  credential?: string;
  select_by?: string;
}

interface GsiIdConfiguration {
  client_id: string;
  callback: (response: GsiCredentialResponse) => void;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  context?: 'signin' | 'signup' | 'use';
  /** UX flow of the rendered Sign In With Google button. Default is 'popup'. */
  ux_mode?: 'popup' | 'redirect';
}

interface GsiButtonConfiguration {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: number;
  locale?: string;
}

interface GoogleGsiSdk {
  accounts: {
    id: {
      initialize(opts: GsiIdConfiguration): void;
      renderButton(parent: HTMLElement, opts: GsiButtonConfiguration): void;
    };
  };
}

interface AppleSignInResponse {
  authorization?: { id_token?: string };
  user?: { email?: string; name?: { firstName?: string; lastName?: string } };
}

interface AppleIdSdk {
  auth: {
    init(opts: { clientId: string; scope: string; redirectURI: string; usePopup: boolean }): void;
    signIn(): Promise<AppleSignInResponse>;
  };
}

type Mode = 'login' | 'register';

/* ------------------------------------------------------------------ */
/* Shared: provider token → session → next page                        */
/* ------------------------------------------------------------------ */

function useSocialFinish(portal: LoginPortal | undefined, mode: Mode) {
  const { socialLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [signingIn, setSigningIn] = useState(false);

  const finish = useCallback(
    async (provider: 'google' | 'apple', idToken: string, extra?: { name?: string; email?: string }, terms?: TermsConsent | null) => {
      setSigningIn(true);
      try {
        // Register mode only: pass proof of Terms acceptance so the backend
        // can record terms_accepted_at server-side. Plain sign-ins of an
        // existing account don't send it.
        const acceptance: TermsAcceptance | undefined =
          mode === 'register' && terms
            ? { terms_version: terms.version, terms_accepted_at: terms.acceptedAt }
            : undefined;
        const role = await socialLogin(provider, idToken, portal, extra, acceptance);
        if (!role) {
          toast.error('Sign-in did not complete. Please try again.');
          return;
        }
        // Registration flow only: if the fresh account has no phone on file,
        // show the ONE required phone step before continuing (the provider
        // already verified the email — no email OTP here).
        if (mode === 'register') {
          const me = await authApi.me().catch(() => null);
          const latestUser = me?.data?.user;
          // users.phone is the source of truth (E.164); profile.phone is a
          // legacy mirror — check both so the gate never misfires.
          const hasPhone = !!(latestUser?.phone || latestUser?.profile?.phone);
          if (latestUser && !hasPhone) {
            setPendingPhoneRole(role);
            navigate('/setup-phone', { replace: true });
            return;
          }
        }
        // Same post-auth routing as password login.
        await navigateAfterLogin(navigate, role, stateFrom(location.state));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Sign-in failed. Please try again or use email instead.');
      } finally {
        setSigningIn(false);
      }
    },
    [socialLogin, portal, navigate, location, mode],
  );

  return { finish, signingIn };
}

/* ------------------------------------------------------------------ */
/* Google                                                              */
/* ------------------------------------------------------------------ */

const GooglePlaceholder: React.FC<{ verb: string; dark: boolean }> = ({ verb, dark }) => (
  <span
    className={`w-full h-11 rounded-full border flex items-center justify-center gap-2.5 ${
      dark ? 'bg-[#202124] border-[#202124] text-white' : 'bg-white border-[#dadce0] text-[#3c4043]'
    }`}
  >
    <GoogleLogo className="w-[18px] h-[18px] shrink-0" />
    <span className="text-[14px] font-medium whitespace-nowrap">{verb} with Google</span>
  </span>
);

/**
 * Official Google button (Google Identity Services, popup — never a new
 * tab). A Google-styled placeholder holds the 44px slot until the real
 * button has painted, so nothing flashes or jumps.
 *
 * NOTE: FedCM is deliberately NOT enabled (no `use_fedcm_for_button`):
 * with it on, the button renders but the click can silently do nothing
 * on browsers where FedCM is unavailable or blocked — no popup, no
 * error, no navigation. The classic popup flow does not have that
 * failure mode.
 */
const GoogleButton: React.FC<{ clientId: string; mode: Mode; onToken: (idToken: string) => void }> = ({ clientId, mode, onToken }) => {
  const { theme } = useTheme();
  const [gisReady, setGisReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastWidthRef = useRef(0);
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  /* Route the (once-registered) GIS callback to this instance. */
  useEffect(() => {
    activeCredentialHandler = (response) => {
      if (response?.credential) onTokenRef.current(response.credential);
      else toast.error('Google did not return a sign-in token. Please try again.');
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let resizeTimer: number | undefined;
    let revealTimer: number | undefined;
    let watchdogTimer: number | undefined;

    const measure = () => Math.min(400, Math.max(200, Math.floor(container.clientWidth) || 320));
    // Record the width BEFORE the async script load so the ResizeObserver's
    // first callback doesn't trigger a second render (that was the flash).
    lastWidthRef.current = measure();

    const render = async () => {
      try {
        await loadScript('https://accounts.google.com/gsi/client');
        if (cancelled) return;
        const google = (window as unknown as { google?: GoogleGsiSdk }).google;
        if (!google?.accounts?.id) throw new Error('Google SDK unavailable');

        if (initializedClientId !== clientId) {
          google.accounts.id.initialize({
            client_id: clientId,
            callback: (response: GsiCredentialResponse) => activeCredentialHandler?.(response),
            ux_mode: 'popup',
            auto_select: false,
            cancel_on_tap_outside: true,
            context: mode === 'register' ? 'signup' : 'signin',
          });
          initializedClientId = clientId;
        }

        const width = measure();
        lastWidthRef.current = width;
        setGisReady(false);
        window.clearTimeout(revealTimer);
        container.innerHTML = '';
        google.accounts.id.renderButton(container, {
          type: 'standard',
          theme: theme === 'dark' ? 'filled_black' : 'outline',
          size: 'large',
          text: mode === 'register' ? 'signup_with' : 'continue_with',
          shape: 'pill',
          logo_alignment: 'left',
          width,
          locale: 'en',
        });

        const iframe = container.querySelector('iframe');
        const reveal = () => !cancelled && setGisReady(true);
        if (iframe) iframe.addEventListener('load', () => window.setTimeout(reveal, 60), { once: true });
        revealTimer = window.setTimeout(reveal, 1500);

        // Watchdog: if Google never paints its button (SDK blocked, or
        // this origin is not allowed for the client id), the slot must
        // not sit there silently dead — say so out loud instead.
        window.clearTimeout(watchdogTimer);
        watchdogTimer = window.setTimeout(() => {
          if (cancelled || !containerRef.current) return;
          if (!containerRef.current.querySelector('iframe')) {
            toast.error('Google sign-in could not be loaded. Please check your connection or use email sign-in.');
          }
        }, 4000);
      } catch {
        if (!cancelled) toast.error('Google sign-in could not be loaded. Please check your connection or use email sign-in.');
      }
    };

    void render();

    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (cancelled || !containerRef.current) return;
        if (Math.abs(measure() - lastWidthRef.current) > 8) void render();
      }, 250);
    });
    observer.observe(container);

    return () => {
      cancelled = true;
      window.clearTimeout(resizeTimer);
      window.clearTimeout(revealTimer);
      window.clearTimeout(watchdogTimer);
      observer.disconnect();
      container.innerHTML = '';
    };
  }, [clientId, theme, mode]);

  const verb = mode === 'register' ? 'Sign up' : 'Continue';

  return (
    <div className="relative w-full h-11" role="group" aria-label={`${verb} with Google`}>
      {/* The placeholder is decorative only — it must never intercept a
          click meant for the real Google button underneath it. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-[400px] transition-opacity duration-200 ${gisReady ? 'opacity-0' : 'opacity-100'}`}
      >
        <GooglePlaceholder verb={verb} dark={theme === 'dark'} />
      </div>
      {/* color-scheme: light — in dark theme the page is color-scheme: dark, and a
          browser paints a cross-scheme iframe with an opaque white background
          (the white strip behind the button). Matching Google's light iframe
          keeps it transparent. */}
      <div
        ref={containerRef}
        style={{ colorScheme: 'light' }}
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${gisReady ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Apple                                                               */
/* ------------------------------------------------------------------ */

const AppleButton: React.FC<{
  clientId: string;
  redirectUri: string;
  mode: Mode;
  busy: boolean;
  onToken: (idToken: string, extra: { name?: string; email?: string }) => void;
}> = ({ clientId, redirectUri, mode, busy, onToken }) => {
  const [starting, setStarting] = useState(false);
  const verb = mode === 'register' ? 'Sign up' : 'Continue';

  const signIn = async () => {
    if (starting || busy) return;
    setStarting(true);
    try {
      await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
      const apple = (window as unknown as { AppleID?: AppleIdSdk }).AppleID;
      if (!apple?.auth) throw new Error('Apple SDK unavailable');
      apple.auth.init({ clientId, scope: 'name email', redirectURI: redirectUri, usePopup: true });
      const res = await apple.auth.signIn();
      const idToken = res?.authorization?.id_token;
      if (!idToken) throw new Error('Apple did not return a sign-in token.');
      const name = [res.user?.name?.firstName, res.user?.name?.lastName].filter(Boolean).join(' ') || undefined;
      onToken(idToken, { name, email: res.user?.email });
    } catch (err) {
      const code = (err as { error?: string })?.error;
      if (code !== 'popup_closed_by_user' && code !== 'user_cancelled_authorize') {
        toast.error(err instanceof Error ? err.message : 'Apple sign-in could not start. Please try again or use email sign-in.');
      }
    } finally {
      setStarting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={signIn}
      disabled={starting || busy}
      className="mx-auto w-full max-w-[400px] h-11 rounded-full bg-black hover:bg-[#1a1a1a] text-white flex items-center justify-center gap-2.5 transition-colors disabled:opacity-70 dark:ring-1 dark:ring-white/20"
    >
      {starting ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <AppleLogo className="w-[18px] h-[18px]" />}
      <span className="text-[14px] font-medium">{verb} with Apple</span>
    </button>
  );
};

/* ------------------------------------------------------------------ */
/* Public component                                                    */
/* ------------------------------------------------------------------ */

interface SocialLoginButtonsProps {
  portal?: LoginPortal;
  /** Slight copy tweak for registration pages. */
  mode?: Mode;
  /** "OR" divider shown above the buttons — hidden together with them. */
  dividerLabel?: string;
  dividerClassName?: string;
  className?: string;
  /**
   * Terms gate (register pages only). When provided and `mode` is
   * 'register', the provider buttons are covered by an intercept layer
   * until consent is accepted — clicking it opens the consent modal via
   * `onRequestConsent` instead of starting the provider flow. No
   * account-creating action is possible without accepted consent.
   */
  termsGate?: {
    consent: TermsConsent | null;
    onRequestConsent: () => void;
  };
}

/**
 * Google / Apple sign-in, as switched on by Super Admin (Admin → Settings →
 * Social sign-in). Providers that are off are not shown at all; with none
 * on, nothing renders (not even the divider).
 *
 * Flow: provider SDK → ID token → POST /api/v1/auth/social/{provider}
 * { id_token, portal } → Sanctum session → next page.
 */
export const SocialLoginButtons: React.FC<SocialLoginButtonsProps> = ({
  portal,
  mode = 'login',
  dividerLabel,
  dividerClassName = 'my-4',
  className = '',
  termsGate,
}) => {
  const providers = useAuthProviders();
  const { theme } = useTheme();
  const { finish, signingIn } = useSocialFinish(portal, mode);

  const google = providers?.google.enabled && providers.google.client_id ? providers.google.client_id : null;
  const apple = providers?.apple.enabled && providers.apple.client_id ? providers.apple : null;

  // Still unknown on a first-ever visit: keep one button slot reserved.
  if (providers && !google && !apple) return null;

  // Consent gate: on registration pages, no provider flow may start before
  // the Terms consent is accepted. The intercept layer sits above the real
  // buttons (including Google's cross-origin iframe, whose clicks we cannot
  // capture) and routes the tap to the consent modal instead.
  const gated = mode === 'register' && termsGate != null && termsGate.consent == null;
  const consent = termsGate?.consent ?? null;

  const divider = dividerLabel ? (
    <div className={`flex items-center gap-4 ${dividerClassName}`} aria-hidden="true">
      <span className="flex-1 h-px bg-slate-200 dark:bg-white/10" />
      <span className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-gray-500 whitespace-nowrap">{dividerLabel}</span>
      <span className="flex-1 h-px bg-slate-200 dark:bg-white/10" />
    </div>
  ) : null;

  return (
    <div className={className}>
      {divider}
      <div className="relative space-y-2.5">
        <div className={gated ? 'opacity-60 saturate-50 pointer-events-none select-none' : undefined} aria-hidden={gated}>
          {!providers && (
            <div className="relative w-full h-11 flex justify-center opacity-60">
              <div className="w-full max-w-[400px]">
                <GooglePlaceholder verb={mode === 'register' ? 'Sign up' : 'Continue'} dark={theme === 'dark'} />
              </div>
            </div>
          )}
          {google && <GoogleButton clientId={google} mode={mode} onToken={(t) => void finish('google', t, undefined, consent)} />}
          {apple && (
            <AppleButton
              clientId={apple.client_id!}
              redirectUri={apple.redirect_uri ?? `${window.location.origin}/login`}
              mode={mode}
              busy={signingIn}
              onToken={(t, extra) => void finish('apple', t, extra, consent)}
            />
          )}
        </div>
        {gated && (
          <button
            type="button"
            onClick={() => termsGate?.onRequestConsent()}
            aria-label="Review and accept the Terms of Service first, then continue with a provider"
            title="Accept the Terms first"
            className="absolute inset-0 w-full rounded-2xl cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#168BFF]/60"
          />
        )}
      </div>
      {signingIn && (
        <div className="mt-2 flex items-center justify-center gap-2 text-[13px] text-slate-500 dark:text-gray-400" role="status">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Signing you in…</span>
        </div>
      )}
    </div>
  );
};
