import { Navigate, Route } from 'react-router-dom';
import { IonRouterOutlet } from '@ionic/react';
import { SplashPage } from '../pages/SplashPage';
import { GetStartedPage } from '../pages/GetStartedPage';
import { LoginPage } from '../pages/LoginPage';
import { SignUpPage } from '../pages/SignUpPage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { OnboardingNamePage } from '../pages/OnboardingNamePage';
import { OnboardingInterestsPage } from '../pages/OnboardingInterestsPage';
import { HomeDashboardPage } from '../pages/HomeDashboardPage';
import { MarketplacePage } from '../pages/MarketplacePage';
import { ArtistProfilePage } from '../pages/ArtistProfilePage';
import { ArtworkDetailPage } from '../pages/ArtworkDetailPage';
import { ProfilePage } from '../pages/ProfilePage';
import { EditProfilePage } from '../pages/EditProfilePage';
import { CommissionWorkspacePage } from '../pages/CommissionWorkspacePage';
import { ProtectionPage } from '../pages/ProtectionPage';
import { ChatInboxPage } from '../pages/ChatInboxPage';
import { ChatPage } from '../pages/ChatPage';
import { AnalyticsPage } from '../pages/AnalyticsPage';
import { PremiumPage } from '../pages/PremiumPage';
import { SettingsPage } from '../pages/SettingsPage';
import { PrivacySecurityPage } from '../pages/PrivacySecurityPage';
import { AccountManagementPage } from '../pages/AccountManagementPage';
import { ArtistVerificationPage } from '../pages/ArtistVerificationPage';
import { ArtistCommissionServicesPage } from '../pages/ArtistCommissionServicesPage';
import { AdminArtistVerificationsPage } from '../pages/AdminArtistVerificationsPage';
import { NotificationsPage } from '../pages/NotificationsPage';
import { FindArtistPage } from '../pages/FindArtistPage';
import { RequireAuth } from './RequireAuth';
import { RequireArtist } from './RequireArtist';
import { RequireAdmin } from './RequireAdmin';

/**
 * Central route table.
 *
 * IMPORTANT: children of <IonRouterOutlet> must be direct <Route> elements
 * (not wrapped in a nested <Routes>). Ionic's view-stack manager walks the
 * outlet's own children directly to build its page/transition stack; a
 * wrapping <Routes> would hide those children from it. Every route below is
 * therefore a flat, direct child of the single top-level outlet, using
 * absolute paths throughout (the same pattern Ionic's own React "tabs"
 * starter template uses for React Router 6).
 */
export function AppRoutes() {
  return (
    <IonRouterOutlet animated={false}>
      <Route path="/" element={<Navigate to="/splash" replace />} />
      <Route path="/splash" element={<SplashPage />} />
      <Route path="/get-started" element={<GetStartedPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Post-sign-up onboarding (protected: account already exists at this point) */}
      <Route
        path="/onboarding/name"
        element={
          <RequireAuth>
            <OnboardingNamePage />
          </RequireAuth>
        }
      />
      <Route
        path="/onboarding/interests"
        element={
          <RequireAuth>
            <OnboardingInterestsPage />
          </RequireAuth>
        }
      />

      {/* Home tab */}
      <Route
        path="/home"
        element={
          <RequireAuth>
            <HomeDashboardPage />
          </RequireAuth>
        }
      />
      <Route
        path="/notifications"
        element={
          <RequireAuth>
            <NotificationsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/home/workspace/:orderId"
        element={
          <RequireAuth>
            <CommissionWorkspacePage />
          </RequireAuth>
        }
      />
      <Route
        path="/home/analytics"
        element={
          <RequireAuth>
            <AnalyticsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/commission/start"
        element={
          <RequireAuth>
            <FindArtistPage />
          </RequireAuth>
        }
      />

      {/* Market tab */}
      <Route
        path="/market"
        element={
          <RequireAuth>
            <MarketplacePage />
          </RequireAuth>
        }
      />
      <Route
        path="/market/artist/:artistId"
        element={
          <RequireAuth>
            <ArtistProfilePage />
          </RequireAuth>
        }
      />
      <Route
        path="/market/artwork/:artworkId"
        element={
          <RequireAuth>
            <ArtworkDetailPage />
          </RequireAuth>
        }
      />

      {/* Shield tab */}
      <Route
        path="/shield"
        element={
          <RequireAuth>
            <RequireArtist>
              <ProtectionPage />
            </RequireArtist>
          </RequireAuth>
        }
      />

      {/* Chat tab: Inbox (list) -> individual conversation */}
      <Route
        path="/chat"
        element={
          <RequireAuth>
            <ChatInboxPage />
          </RequireAuth>
        }
      />
      <Route
        path="/chat/:conversationId"
        element={
          <RequireAuth>
            <ChatPage />
          </RequireAuth>
        }
      />

      {/* Profile tab */}
      <Route
        path="/profile"
        element={
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        }
      />
      <Route
        path="/profile/edit"
        element={
          <RequireAuth>
            <EditProfilePage />
          </RequireAuth>
        }
      />
      <Route
        path="/profile/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/profile/settings/privacy"
        element={
          <RequireAuth>
            <PrivacySecurityPage />
          </RequireAuth>
        }
      />
      <Route
        path="/profile/settings/account"
        element={
          <RequireAuth>
            <AccountManagementPage />
          </RequireAuth>
        }
      />
      <Route
        path="/profile/settings/verification"
        element={
          <RequireAuth>
            <RequireArtist>
              <ArtistVerificationPage />
            </RequireArtist>
          </RequireAuth>
        }
      />
      <Route
        path="/profile/settings/services"
        element={
          <RequireAuth>
            <RequireArtist>
              <ArtistCommissionServicesPage />
            </RequireArtist>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/artist-verifications"
        element={
          <RequireAuth>
            <RequireAdmin>
              <AdminArtistVerificationsPage />
            </RequireAdmin>
          </RequireAuth>
        }
      />
      <Route
        path="/profile/premium"
        element={
          <RequireAuth>
            <PremiumPage />
          </RequireAuth>
        }
      />

      <Route path="*" element={<Navigate to="/splash" replace />} />
    </IonRouterOutlet>
  );
}
