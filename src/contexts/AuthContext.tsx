import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import {
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth } from '../firebase';
import { API_BASE } from '../lib/api';

interface AuthContextValue {
  user: User | null;
  authLoading: boolean;
  isPremium: boolean;
  subscriptionLoaded: boolean;
  showPremiumModal: boolean;
  setShowPremiumModal: (v: boolean) => void;
  showAuthModal: boolean;
  setShowAuthModal: (v: boolean) => void;
  handleLogin: () => void;
  handleGoogleSignIn: () => Promise<void>;
  handleEmailSignIn: (email: string, password: string) => Promise<void>;
  handleEmailSignUp: (name: string, email: string, password: string) => Promise<void>;
  handleForgotPassword: (email: string) => Promise<void>;
  handleLogout: () => Promise<void>;
  getApiToken: () => Promise<string | null>;
  refreshSubscription: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isPremium, setIsPremium] = useState(false);
  const [subscriptionLoaded, setSubscriptionLoaded] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const fetchSubscription = async (
    firebaseUser: { uid: string; getIdToken: (forceRefresh?: boolean) => Promise<string> },
  ) => {
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 8000);
    try {
      const token = await Promise.race([
        firebaseUser.getIdToken(true),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('token timeout')), 8000)
        ),
      ]);
      const res = await fetch(`${API_BASE}/user/subscription`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        setIsPremium(data.is_premium === true);
      } else {
        setIsPremium(false);
      }
    } catch {
      setIsPremium(false);
    } finally {
      clearTimeout(fetchTimeout);
      setSubscriptionLoaded(true);
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (u) {
        void fetchSubscription(u);
      } else {
        setIsPremium(false);
        setSubscriptionLoaded(true);
      }
    });
    return unsub;
  }, []);

  const handleLogin = () => setShowAuthModal(true);

  const handleGoogleSignIn = async () => {
    await signInWithPopup(auth, new GoogleAuthProvider());
    setShowAuthModal(false);
  };

  const handleEmailSignIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
    setShowAuthModal(false);
  };

  const handleEmailSignUp = async (name: string, email: string, password: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    setShowAuthModal(false);
  };

  const handleForgotPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  const handleLogout = async () => {
    try { await signOut(auth); } catch {}
    setUser(null);
    setIsPremium(false);
    setSubscriptionLoaded(false);
  };

  const getApiToken = async (): Promise<string | null> => {
    try {
      return (await auth.currentUser?.getIdToken()) ?? null;
    } catch {
      return null;
    }
  };

  const refreshSubscription = async (): Promise<void> => {
    const u = auth.currentUser;
    if (u) await fetchSubscription(u);
  };

  return (
    <AuthContext.Provider value={{
      user,
      authLoading,
      isPremium,
      subscriptionLoaded,
      showPremiumModal,
      setShowPremiumModal,
      showAuthModal,
      setShowAuthModal,
      handleLogin,
      handleGoogleSignIn,
      handleEmailSignIn,
      handleEmailSignUp,
      handleForgotPassword,
      handleLogout,
      getApiToken,
      refreshSubscription,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
