import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NodemailerImpl } from './index';

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  emailEnv: {
    SMTP_FROM: 'Old Brand <mailer@example.test>',
    SMTP_HOST: 'smtp.example.test',
    SMTP_PASS: 'fixture-only',
    SMTP_PORT: 465,
    SMTP_SECURE: true,
    SMTP_USER: 'account@example.test',
  },
  sendMail: vi.fn(),
  transportLog: vi.fn(),
  transportErrorLog: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('@/envs/email', () => ({ emailEnv: mocks.emailEnv }));

vi.mock('debug', () => ({
  default: vi.fn(() =>
    Object.assign(mocks.transportLog, { extend: vi.fn(() => mocks.transportErrorLog) }),
  ),
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: mocks.createTransport,
    getTestMessageUrl: vi.fn(() => false),
  },
}));

describe('NodemailerImpl transaction mail headers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendMail.mockResolvedValue({ messageId: 'fixture-message' });
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail, verify: mocks.verify });
    mocks.emailEnv.SMTP_FROM = 'Old Brand <mailer@example.test>';
  });

  it('uses the configured sender mailbox with the 旅游群网 display name', async () => {
    const impl = new NodemailerImpl();

    await impl.sendMail({
      from: 'Untrusted Sender <attacker@example.test>',
      html: '<p>验证邮箱 https://travel.example.test/lobehub/action?state=mail-fixture</p>',
      replyTo: 'support@example.test',
      subject: '验证邮箱｜旅游群网',
      text: '验证邮箱 https://travel.example.test/lobehub/action?state=mail-fixture',
      to: 'customer@example.test',
    });

    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { address: 'mailer@example.test', name: '旅游群网' },
        html: '<p>验证邮箱 https://travel.example.test/lobehub/action?state=mail-fixture</p>',
        replyTo: 'support@example.test',
        text: '验证邮箱 https://travel.example.test/lobehub/action?state=mail-fixture',
      }),
    );
    const logOutput = JSON.stringify([
      ...mocks.transportLog.mock.calls,
      ...mocks.transportErrorLog.mock.calls,
    ]);
    expect(logOutput).not.toContain('fixture-only');
    expect(logOutput).not.toContain('mail-fixture');
    expect(JSON.stringify(mocks.sendMail.mock.calls)).not.toContain('Old Brand');
    expect(JSON.stringify(mocks.sendMail.mock.calls)).not.toContain('attacker@example.test');
    expect(JSON.stringify(mocks.sendMail.mock.calls)).not.toContain('fixture-only');
  });

  it('falls back to SMTP_USER while preserving the fixed display name', async () => {
    mocks.emailEnv.SMTP_FROM = '';
    const impl = new NodemailerImpl();

    await impl.sendMail({
      subject: '登录链接｜旅游群网',
      text: '登录链接',
      to: 'customer@example.test',
    });

    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { address: mocks.emailEnv.SMTP_USER, name: '旅游群网' },
      }),
    );
  });

  it('rejects malformed or multiple Reply-To mailboxes before SMTP delivery', async () => {
    const impl = new NodemailerImpl();

    await expect(
      impl.sendMail({
        replyTo: 'support@example.test, attacker@example.test',
        subject: '验证邮箱｜旅游群网',
        text: '验证邮箱',
        to: 'customer@example.test',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });
});
