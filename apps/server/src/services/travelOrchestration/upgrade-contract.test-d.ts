import type { OperationToolDispatchPolicy } from '@lobechat/types';
import { expectTypeOf } from 'vitest';

import type {
  TRAVEL_SPECIALIST_UNAVAILABLE,
  TravelOrchestrationInput,
  TravelOrchestrationMember,
  TravelProductionIntent,
  TravelRoutingResult,
  TravelToolDispatchResult,
} from './index';
import { createTravelToolDispatchPolicy, routeTravelRequest } from './index';

type ExpectedRoutingResult =
  | {
      intents: [TravelProductionIntent, ...TravelProductionIntent[]];
      memberIds: [string, ...string[]];
      mode: 'delegate';
    }
  | {
      intents: [];
      memberIds: [];
      mode: 'supervisor-fallback';
      reason: 'policy-denied' | 'safe-informational' | 'unknown-intent';
    }
  | {
      error: typeof TRAVEL_SPECIALIST_UNAVAILABLE;
      intents: [TravelProductionIntent, ...TravelProductionIntent[]];
      memberIds: [];
      mode: 'unavailable';
    };

type DelegateRoute = Extract<ExpectedRoutingResult, { mode: 'delegate' }>;
type SupervisorFallbackRoute = Extract<ExpectedRoutingResult, { mode: 'supervisor-fallback' }>;
type UnavailableRoute = Extract<ExpectedRoutingResult, { mode: 'unavailable' }>;

type ExpectedDispatchResult =
  | { mode: 'delegate'; policy: OperationToolDispatchPolicy; route: DelegateRoute }
  | { mode: 'supervisor-fallback'; route: SupervisorFallbackRoute }
  | {
      error: typeof TRAVEL_SPECIALIST_UNAVAILABLE;
      mode: 'unavailable';
      route: UnavailableRoute;
    };

expectTypeOf<TravelProductionIntent>().toEqualTypeOf<'copy' | 'image' | 'video' | 'document'>();
expectTypeOf<TravelOrchestrationMember>().toEqualTypeOf<{
  clientId: string | null;
  enabled?: boolean;
  id: string;
}>();
expectTypeOf<TravelOrchestrationInput>().toEqualTypeOf<{
  members: TravelOrchestrationMember[];
  message: string;
  previousTurn?: {
    confirmedIntents: readonly TravelProductionIntent[];
    taskStatus?: 'failed' | 'pending' | 'queued' | 'running' | 'succeeded' | 'unavailable';
  };
}>();
expectTypeOf<TravelRoutingResult>().toEqualTypeOf<ExpectedRoutingResult>();
expectTypeOf<TravelToolDispatchResult>().toEqualTypeOf<ExpectedDispatchResult>();
expectTypeOf<TravelToolDispatchResult['mode']>().toEqualTypeOf<
  'delegate' | 'supervisor-fallback' | 'unavailable'
>();
expectTypeOf<Extract<TravelRoutingResult, { mode: 'delegate' }>['intents']>().toMatchTypeOf<
  [TravelProductionIntent, ...TravelProductionIntent[]]
>();
expectTypeOf<Extract<TravelRoutingResult, { mode: 'delegate' }>['memberIds']>().toMatchTypeOf<
  [string, ...string[]]
>();
expectTypeOf<
  Extract<TravelToolDispatchResult, { mode: 'delegate' }>['route']
>().toEqualTypeOf<DelegateRoute>();
expectTypeOf<
  Extract<TravelToolDispatchResult, { mode: 'supervisor-fallback' }>['route']
>().toEqualTypeOf<SupervisorFallbackRoute>();
expectTypeOf<
  Extract<TravelToolDispatchResult, { mode: 'unavailable' }>['route']
>().toEqualTypeOf<UnavailableRoute>();
expectTypeOf<
  'policy' extends keyof Extract<TravelToolDispatchResult, { mode: 'supervisor-fallback' }>
    ? true
    : false
>().toEqualTypeOf<false>();
expectTypeOf<
  'policy' extends keyof Extract<TravelToolDispatchResult, { mode: 'unavailable' }> ? true : false
>().toEqualTypeOf<false>();
expectTypeOf(routeTravelRequest).parameter(0).toEqualTypeOf<TravelOrchestrationInput>();
expectTypeOf(routeTravelRequest).returns.toEqualTypeOf<TravelRoutingResult>();
expectTypeOf(createTravelToolDispatchPolicy).parameter(0).toEqualTypeOf<TravelOrchestrationInput>();
expectTypeOf(createTravelToolDispatchPolicy).returns.toEqualTypeOf<TravelToolDispatchResult>();
