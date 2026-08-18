'use client';

import { useContext, useLayoutEffect } from 'react';
import { ShellTitleContext } from '@/lib/shell-title';

export default function AppShell({ title, children }) {
  const setTitle = useContext(ShellTitleContext);

  useLayoutEffect(() => {
    if (setTitle) setTitle(title || 'HRMS');
  }, [setTitle, title]);

  return children;
}
