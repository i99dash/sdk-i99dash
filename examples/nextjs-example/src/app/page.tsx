import ContextCard from '@/components/ContextCard.client';
import DrivingBanner from '@/components/DrivingBanner.client';
import StationList from '@/components/StationList.client';

/// Landing page — server-rendered shell that hosts the three
/// client components. Everything that touches `window` is inside a
/// `'use client'` module so SSR stays clean.
export default function Home() {
  return (
    <main>
      <h1>Next.js mini-app</h1>
      <DrivingBanner />
      <ContextCard />
      <StationList />
    </main>
  );
}
