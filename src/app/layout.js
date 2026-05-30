import './globals.css';
import { AuthProvider } from '@/lib/auth';

export const metadata = {
  title: 'HRMS Admin Panel',
  description: 'Enterprise Human Resource Management System',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <AuthProvider>
          {children}
        </AuthProvider>
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js" async />
      </body>
    </html>
  );
}
