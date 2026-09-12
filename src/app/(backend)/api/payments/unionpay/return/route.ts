import { handlePaymentReturn } from '@/server/services/domesticPayment/notification';

export const runtime = 'nodejs';
export const GET = () => handlePaymentReturn();
export const POST = () => handlePaymentReturn();
