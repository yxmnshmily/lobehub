import { describe, expect, it } from 'vitest';

import {
  coordinatorGateKind,
  coordinatorGateReason,
  coordinatorOptionLabelKey,
  coordinatorReasonCopy,
} from './coordinatorCopy';

const decision = (ids: string[]) => ({ options: ids.map((id) => ({ id, label: id })) }) as any;

describe('coordinatorOptionLabelKey', () => {
  it('preserves the backend label for a group replanning gate', () => {
    const kind = coordinatorGateKind(decision(['retry']));
    expect(coordinatorOptionLabelKey('retry', kind)).toBeUndefined();
  });

  it('keeps existing recovery and acceptance gate translations', () => {
    expect(coordinatorOptionLabelKey('retry', 'recoverTask')).toBe('goalProcess.gate.option.retry');
    expect(coordinatorOptionLabelKey('retire', 'recoverTask')).toBe(
      'goalProcess.gate.option.retire',
    );
    expect(coordinatorOptionLabelKey('retry', 'goalAcceptance')).toBe(
      'goalProcess.gate.option.retry',
    );
    expect(coordinatorOptionLabelKey('fail', 'goalAcceptance')).toBe(
      'goalProcess.gate.option.fail',
    );
    expect(coordinatorOptionLabelKey('custom', 'recoverTask')).toBeUndefined();
  });
});

describe('coordinatorGateKind', () => {
  it('recognizes the two coordinator gate shapes and nothing else', () => {
    expect(coordinatorGateKind(decision(['retry', 'retire']))).toBe('recoverTask');
    expect(coordinatorGateKind(decision(['retry', 'fail']))).toBe('goalAcceptance');
    expect(coordinatorGateKind(decision(['approve', 'reject']))).toBeUndefined();
    expect(coordinatorGateKind(undefined)).toBeUndefined();
  });
});

describe('coordinatorNodeTitleKey', () => {
  it('maps the terminal acceptance task and coordinator gates to locale keys', async () => {
    const { coordinatorNodeTitleKey } = await import('./coordinatorCopy');
    const view = (node: any, dec?: any) => ({ decision: dec, humanTouches: [], node }) as any;

    expect(
      coordinatorNodeTitleKey(view({ kind: 'task', title: 'Complete full Goal acceptance' })),
    ).toBe('goalProcess.node.terminalAcceptance');
    expect(
      coordinatorNodeTitleKey(
        view({ kind: 'decision', title: 'x' }, decision(['retry', 'retire'])),
      ),
    ).toBe('goalProcess.gate.title.recoverTask');
    expect(coordinatorNodeTitleKey(view({ kind: 'task', title: '普通任务' }))).toBeUndefined();
  });
});

describe('coordinatorGateReason', () => {
  it('strips the question template down to the reason', () => {
    expect(
      coordinatorGateReason(
        'Verification could not run (internal error); the delivery was not evaluated.. Retry or retire this task node?',
      ),
    ).toBe('Verification could not run (internal error); the delivery was not evaluated.');
    expect(
      coordinatorGateReason(
        'Goal-level acceptance did not pass. Retry Goal acceptance or fail this Goal?',
      ),
    ).toBe('Goal-level acceptance did not pass');
  });

  it('returns non-template questions verbatim', () => {
    expect(coordinatorGateReason('Which dataset should the ablation use?')).toBe(
      'Which dataset should the ablation use?',
    );
  });
});

describe('coordinatorReasonCopy', () => {
  it('maps every known coordinator reason to a locale ref', () => {
    expect(
      coordinatorReasonCopy(
        'Verification could not run (internal error); the delivery was not evaluated.',
      ),
    ).toEqual({ key: 'goalProcess.gate.reason.verifyInternalError' });
    expect(coordinatorReasonCopy('Task T-932 did not pass verification')).toEqual({
      key: 'goalProcess.gate.reason.verifyFailed',
      params: { id: 'T-932' },
    });
    expect(coordinatorReasonCopy('Task attempt budget was exhausted')).toEqual({
      key: 'goalProcess.gate.reason.attemptBudgetExhausted',
    });
    expect(
      coordinatorReasonCopy('Goal cost budget was exhausted after an operation was abandoned'),
    ).toEqual({ key: 'goalProcess.gate.reason.costBudgetExhausted' });
    expect(coordinatorReasonCopy('Automatic recovery could not start the next attempt')).toEqual({
      key: 'goalProcess.gate.reason.recoveryFailed',
    });
  });

  it('passes unknown reasons through as undefined so the raw text renders', () => {
    expect(coordinatorReasonCopy('some future reason')).toBeUndefined();
    expect(coordinatorReasonCopy(undefined)).toBeUndefined();
  });
});
