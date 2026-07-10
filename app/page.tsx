import { redirect } from 'next/navigation';

// Root page: redirect to /login or /dashboard based on session
export default function RootPage() {
  redirect('/login');
}
