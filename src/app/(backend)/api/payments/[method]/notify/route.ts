import { handlePaymentNotification } from '@/server/services/domesticPayment/notification';

export const runtime = 'nodejs';
export const POST = async (request: Request, context: { params: Promise<{ method: string }> }) =>
  handlePaymentNotification(request, (await context.params).method);
