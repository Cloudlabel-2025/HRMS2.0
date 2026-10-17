import { redirect } from 'next/navigation';

export default function LeavePoliciesRedirect() {
  redirect('/admin/control-center');
}
