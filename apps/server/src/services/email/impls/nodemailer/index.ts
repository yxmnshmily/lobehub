import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { type Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';
import addressparser from 'nodemailer/lib/addressparser';
import { z } from 'zod';

import { emailEnv } from '@/envs/email';

import { type EmailPayload, type EmailResponse, type EmailServiceImpl } from '../type';
import { type NodemailerConfig } from './type';

const log = debug('lobe-email:Nodemailer');
const TRANSACTION_MAIL_DISPLAY_NAME = '旅游群网';

const resolveSingleMailbox = (value: string, field: 'From' | 'Reply-To'): string => {
  const mailboxes = addressparser(value, { flatten: true });
  const address = mailboxes.length === 1 ? mailboxes[0]?.address : undefined;

  if (!address || !z.email().safeParse(address).success) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `${field} must contain one valid email address`,
    });
  }

  return address;
};

/**
 * Nodemailer implementation of the email service
 */
export class NodemailerImpl implements EmailServiceImpl {
  private transporter: Transporter;

  constructor() {
    log('Initializing Nodemailer from environment variables');

    if (!emailEnv.SMTP_USER || !emailEnv.SMTP_PASS) {
      throw new Error(
        'SMTP_USER and SMTP_PASS environment variables are required to use email service. Please configure SMTP settings in your .env file.',
      );
    }

    // Note: Use || to handle empty string from Dockerfile defaults
    const transportConfig: NodemailerConfig = {
      auth: {
        pass: emailEnv.SMTP_PASS,
        user: emailEnv.SMTP_USER,
      },
      host: emailEnv.SMTP_HOST || 'localhost',
      port: emailEnv.SMTP_PORT || 587,
      secure: emailEnv.SMTP_SECURE || false,
    };

    try {
      this.transporter = nodemailer.createTransport(transportConfig);
      log('Nodemailer transporter created successfully');
    } catch (error) {
      log.extend('error')('Failed to create Nodemailer transporter: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to initialize Nodemailer transport',
      });
    }
  }

  async sendMail(payload: EmailPayload): Promise<EmailResponse> {
    // Transactional mail always uses the configured sender; callers cannot spoof the From mailbox.
    const senderAddress = resolveSingleMailbox(emailEnv.SMTP_FROM || emailEnv.SMTP_USER!, 'From');
    const from = { address: senderAddress, name: TRANSACTION_MAIL_DISPLAY_NAME };
    const replyTo = payload.replyTo ? resolveSingleMailbox(payload.replyTo, 'Reply-To') : undefined;

    log('Sending email with payload: %o', {
      from,
      subject: payload.subject,
      to: payload.to,
    });

    try {
      const info = await this.transporter.sendMail({
        attachments: payload.attachments,
        from,
        html: payload.html,
        replyTo,
        subject: payload.subject,
        text: payload.text,
        to: payload.to,
      });

      log('Email sent successfully with message ID: %s', info.messageId);

      const previewUrl = nodemailer.getTestMessageUrl(info);

      return {
        messageId: info.messageId,
        previewUrl: previewUrl || undefined,
      };
    } catch (error) {
      log.extend('error')('Failed to send email: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: `Failed to send email: ${(error as Error).message}`,
      });
    }
  }

  /**
   * Verify the SMTP connection configuration
   */
  async verify(): Promise<boolean> {
    try {
      log('Verifying SMTP connection...');
      await this.transporter.verify();
      log('SMTP connection verified successfully');
      return true;
    } catch (error) {
      log.extend('error')('SMTP verification failed: %o', error);
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to verify SMTP connection',
      });
    }
  }
}
