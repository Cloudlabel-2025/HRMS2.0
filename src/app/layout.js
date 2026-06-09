import './globals.css';
import { Geist } from 'next/font/google';
import { AuthProvider } from '@/lib/auth';
import { SettingsProvider } from '@/lib/settings';

const geist = Geist({
  subsets: ['latin'],
  display: 'swap',
});

export const metadata = {
  title: 'HRMS Admin Panel',
  description: 'Enterprise Human Resource Management System',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={geist.className}>
      <body suppressHydrationWarning>
        <AuthProvider>
          <SettingsProvider>
            {children}
          </SettingsProvider>
        </AuthProvider>
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js" async />
      </body>
    </html>
  );
}
