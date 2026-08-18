import { PersistentAppShell } from '@/components/PersistentAppShell';

export default function ProtectedLayout({ children }) {
  return <PersistentAppShell>{children}</PersistentAppShell>;
}
