import React, { Suspense, lazy, useEffect, useState } from 'react';
const DomainWorkbench = lazy(() => import('./DomainWorkbench.jsx'));
const TestnetDemo = lazy(() => import('./TestnetDemo.jsx'));
import Platform from './Platform.jsx';
const LegacyApp = lazy(() => import('./LegacyApp.jsx'));
const currentPath = () => window.location.hash.replace(/^#/, '') || '/';
export default function App() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => { const update = () => setPath(currentPath()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  if (path.startsWith('/legacy')) return <><a className="legacy-return" href="/">Return to the platform</a><Suspense fallback={<p>Loading archived records.</p>}><LegacyApp /></Suspense></>;
  if (path === '/demo') return <Suspense fallback={<p>Loading archived verification records.</p>}><TestnetDemo /></Suspense>;
  if (path.startsWith('/domains/')) return <Suspense fallback={<p>Loading the archived review screen.</p>}><DomainWorkbench path={path} /></Suspense>;
  return <Platform />;
}
