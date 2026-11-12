import { Navigate, Route, Routes } from 'react-router';
import { GuestOnly } from '@/features/auth/GuestOnly';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { ProfilePage } from '@/features/auth/ProfilePage';
import { AcceptInvitePage } from '@/features/invites/AcceptInvitePage';
import { BoardPage } from '@/features/board/BoardPage';
import { TaskDrawer } from '@/features/board/TaskDrawer';
import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { ProjectSettingsPage } from '@/features/projects/ProjectSettingsPage';
import { MyTasksPage } from '@/features/projects/MyTasksPage';
import { MembersPage } from '@/features/members/MembersPage';
import { CreateWorkspacePage } from '@/features/workspace/CreateWorkspacePage';
import { SettingsPage } from '@/features/workspace/SettingsPage';
import { WorkspaceLayout } from '@/features/workspace/WorkspaceLayout';
import { WorkspacesPage } from '@/features/workspace/WorkspacesPage';
import { ComingSoon } from '@/components/ComingSoon';
import { NotFoundPage } from '@/components/NotFoundPage';

export function AppRoutes() {
  return (
    <Routes>
      {/* Logged-in users skip these and go straight to returnTo */}
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
      {/* Public: works logged in or out (must stay OUTSIDE RequireAuth) */}
      <Route path="/invite/:token" element={<AcceptInvitePage />} />

      <Route element={<RequireAuth />}>
        <Route path="/workspaces" element={<WorkspacesPage />} />
        <Route path="/onboarding" element={<CreateWorkspacePage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/w/:slug" element={<WorkspaceLayout />}>
          <Route index element={<Navigate to="projects" replace />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="p/:key/settings" element={<ProjectSettingsPage />} />
          <Route path="p/:key" element={<BoardPage />}>
            <Route index element={<Navigate to="board" replace />} />
            <Route path="board" element={null} />
            {/* The drawer: the board stays rendered underneath (FR-TSK-07) */}
            <Route path="tasks/:number" element={<TaskDrawer />} />
          </Route>
          <Route path="my-tasks" element={<MyTasksPage />} />
          <Route path="activity" element={<ComingSoon title="Activity" day={16} />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/workspaces" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
