import React,{useState} from 'react';
import {usePlatform} from './PlatformContext.jsx';
import {Modal,Button,Panel} from './PlatformUI.jsx';
function CredentialFields({username,setUsername,password,setPassword,signup}) {
  return <><label className="q-field">Username<input required autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={32} pattern={"[a-zA-Z0-9._\\-]{3,32}"} value={username} onChange={e=>setUsername(e.target.value)} placeholder="Your username"/>{signup&&<small>3–32 letters, numbers, dots, underscores or hyphens.</small>}</label><label className="q-field">Password<input required type="password" autoComplete={signup?'new-password':'current-password'} minLength={signup?8:undefined} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} placeholder={signup?'At least 8 characters':'Your password'}/></label></>;
}
export function AccountAccess() {
  const p=usePlatform(),[signup,setSignup]=useState(false),[username,setUsername]=useState(''),[password,setPassword]=useState('');
  if(!p.authOpen)return null;
  return <Modal title={signup?'Create your account':'Welcome to Veilvest'} busy={p.busy} onClose={()=>{p.setAuthOpen(false);setPassword('');}}>
    <p className="q-muted">{signup?'Invest and manage strategies with one account.':'Sign in to invest, check your assets and manage strategies.'} You only need a wallet to add funds.</p>
    <form className="q-account-form" onSubmit={async e=>{e.preventDefault();if(await p.authenticate({username,password},signup))setPassword('');}}>
      <CredentialFields {...{username,setUsername,password,setPassword,signup}}/>
      {p.message?.error&&<p className="q-error" role="alert">{p.message.text}</p>}
      <Button className="q-full" disabled={p.busy} type="submit">{p.busy?'Please wait…':signup?'Create account':'Sign in'}</Button>
    </form>
    <button className="q-text-link q-space" onClick={()=>{setSignup(!signup);p.notify('');}}>{signup?'Already have an account? Sign in':'New here? Create an account'}</button>
    <details className="q-technical"><summary>Already invested with a wallet?</summary><p>Verify your existing wallet once, then set a username and password in account settings. Your investments stay with your account.</p><Button secondary disabled={p.busy} onClick={p.walletLogin}>Recover existing wallet account</Button></details>
  </Modal>;
}
export function AccountCredentials() {
  const p=usePlatform(),[username,setUsername]=useState(''),[password,setPassword]=useState('');
  return <Panel><h2>Account access</h2>{p.session?.username?<p className="q-muted">Signed in as <strong>{p.session.username}</strong>. Your account works without a connected wallet.</p>:<form className="q-account-form" onSubmit={async e=>{e.preventDefault();if(await p.setCredentials({username,password}))setPassword('');}}><p className="q-muted">Set your username and password for future sign-ins.</p><CredentialFields {...{username,setUsername,password,setPassword,signup:true}}/><Button type="submit" disabled={p.busy}>Save account access</Button></form>}<p className="q-muted q-space">Funding and payout wallet: {p.session?.wallet||'No funding wallet yet. Link one with your first deposit.'}</p></Panel>;
}
