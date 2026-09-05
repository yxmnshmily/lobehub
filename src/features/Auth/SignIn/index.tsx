'use client';

import DevSeedSignIn from './DevSeedSignIn';
import { SignInEmailSentStep } from './SignInEmailSentStep';
import { SignInEmailStep } from './SignInEmailStep';
import { SignInPasswordStep } from './SignInPasswordStep';
import { useSignIn } from './useSignIn';
import { WechatSignInModal } from './WechatSignInModal';

const SignIn = () => {
  const {
    authMode,
    callbackUrl,
    closeWechatAuth,
    disableEmailPassword,
    email,
    enablePhoneAuth,
    form,
    handleBackFromSent,
    handleBackToEmail,
    handleCheckUser,
    handleForgotPassword,
    handleGoToSignup,
    handleResendEmail,
    handleSignIn,
    handleSocialSignIn,
    isSocialOnly,
    lastAuthProvider,
    loading,
    oAuthSSOProviders,
    sending,
    sessionExpired,
    sentInfo,
    serverConfigInit,
    setAuthMode,
    socialLoading,
    step,
    wechatAuthUrl,
  } = useSignIn();

  if (step === 'emailSent' && sentInfo)
    return (
      <SignInEmailSentStep
        email={sentInfo.email}
        sending={sending}
        type={sentInfo.type}
        onBack={handleBackFromSent}
        onResend={handleResendEmail}
      />
    );

  if (step === 'password')
    return (
      <SignInPasswordStep
        email={email}
        forgotLoading={sending}
        form={form as any}
        loading={loading}
        onBackToEmail={handleBackToEmail}
        onForgotPassword={handleForgotPassword}
        onSubmit={handleSignIn}
      />
    );

  return (
    <>
      <SignInEmailStep
        authMode={authMode}
        callbackUrl={callbackUrl}
        disableEmailPassword={disableEmailPassword}
        enablePhoneAuth={enablePhoneAuth}
        form={form as any}
        isSocialOnly={isSocialOnly}
        lastAuthProvider={lastAuthProvider}
        loading={loading}
        oAuthSSOProviders={oAuthSSOProviders}
        serverConfigInit={serverConfigInit}
        sessionExpired={sessionExpired}
        setAuthMode={setAuthMode}
        socialLoading={socialLoading}
        onCheckUser={handleCheckUser}
        onGoToSignup={handleGoToSignup}
        onResetEmail={handleBackToEmail}
        onSetPassword={handleForgotPassword}
        onSocialSignIn={handleSocialSignIn}
      />
      <WechatSignInModal
        authUrl={wechatAuthUrl}
        callbackUrl={callbackUrl}
        onClose={closeWechatAuth}
      />
      <DevSeedSignIn />
    </>
  );
};

export default SignIn;
