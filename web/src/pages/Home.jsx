// The redesigned Home page — ported from the design-tool export's
// home/HomeSections{1,2,3}.jsx (converted to real ES module components, see
// their own headers) plus its local-only interactive demo marketplace
// (post-a-load / bid overlays / job drawer / command palette / toasts — all
// client-side fake state, no server calls; see lib/homeRuntime.js).
// Replaces the previous CinematicLanding page, which iframed the static
// web/public/loadbyton-cinematic-home.html document this export was itself
// generated from (see github.md in the export).
import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, homePath } from '../lib/auth.jsx';
import { Spinner } from '../components/ui.jsx';
import { initHomeRuntime } from '../lib/homeRuntime.js';
import { SiteProgress, SiteNav, SiteMobileNav, SiteFooter } from '../components/marketing/SiteChrome.jsx';
import { HomeHero, HomeMarquee, HomeProblem } from '../components/marketing/home/HomeSections1.jsx';
import { HomeSolution, HomeProcess, HomeDevices, HomeDemo, HomeSection, HomeTrust } from '../components/marketing/home/HomeSections2.jsx';
import {
  HomeSection2, HomeCtaWrap, HomePostoverlay, HomeBidoverlay, HomeDrawerwrap, HomeCommandoverlay, HomeToasts,
} from '../components/marketing/home/HomeSections3.jsx';

export function HomeContent() {
  useEffect(() => {
    const destroy = initHomeRuntime();
    return destroy;
  }, []);

  return (
    <div className="mkt-scope">
      <SiteProgress />
      <SiteNav />
      <SiteMobileNav />
      <main id="top">
        <HomeHero />
        <HomeMarquee />
        <HomeProblem />
        <HomeSolution />
        <HomeProcess />
        <HomeDevices />
        <HomeDemo />
        <HomeSection />
        <HomeTrust />
        <HomeSection2 />
        <HomeCtaWrap />
      </main>
      <SiteFooter />
      <HomePostoverlay />
      <HomeBidoverlay />
      <HomeDrawerwrap />
      <HomeCommandoverlay />
      <HomeToasts />
    </div>
  );
}

export default function Home() {
  const { user, actingAs, loading } = useAuth();
  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center" style={{ background: 'var(--lb-ink-950)' }}><Spinner size={28} className="text-white" /></div>;
  }
  if (user) return <Navigate to={homePath(user, actingAs)} replace />;

  return <HomeContent />;
}
