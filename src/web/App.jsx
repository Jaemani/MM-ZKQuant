import React, { Suspense, lazy, useEffect, useState } from 'react';
import DomainWorkbench from './DomainWorkbench.jsx';
const LegacyApp = lazy(() => import('./LegacyApp.jsx'));
const currentPath = () => window.location.hash.replace(/^#/, '') || '/domains/overview';
export default function App() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => { const update = () => setPath(currentPath()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  if (path.startsWith('/legacy')) return <><a className="legacy-return" href="#/domains/settlement/state">현재 서비스로 돌아가기</a><Suspense fallback={<p>이전 기록을 불러오는 중입니다.</p>}><LegacyApp /></Suspense></>;
  return <DomainWorkbench path={path.startsWith('/domains/')?path:'/domains/overview'} />;
}
