import React, { Suspense, lazy, useEffect, useState } from 'react';
const DomainWorkbench = lazy(() => import('./DomainWorkbench.jsx'));
const TestnetDemo = lazy(() => import('./TestnetDemo.jsx'));
import Platform from './Platform.jsx';
const LegacyApp = lazy(() => import('./LegacyApp.jsx'));
const currentPath = () => window.location.hash.replace(/^#/, '') || '/';
export default function App() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => { const update = () => setPath(currentPath()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  if (path.startsWith('/legacy')) return <><a className="legacy-return" href="#/domains/settlement/state">현재 서비스로 돌아가기</a><Suspense fallback={<p>이전 기록을 불러오는 중입니다.</p>}><LegacyApp /></Suspense></>;
  if (path === '/demo') return <Suspense fallback={<p>이전 검증 기록을 불러오는 중입니다.</p>}><TestnetDemo /></Suspense>;
  if (path.startsWith('/domains/')) return <Suspense fallback={<p>이전 검토 화면을 불러오는 중입니다.</p>}><DomainWorkbench path={path} /></Suspense>;
  return <Platform />;
}
