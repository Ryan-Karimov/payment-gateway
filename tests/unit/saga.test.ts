import { describe, it, expect, vi } from 'vitest';
import { createSaga, SagaOrchestrator } from '../../src/services/saga.service.js';

interface TestContext {
  value: number;
  steps: string[];
  shouldFail?: boolean;
}

describe('Saga Service', () => {
  describe('createSaga', () => {
    it('should create a new saga orchestrator', () => {
      const saga = createSaga<TestContext>();
      expect(saga).toBeInstanceOf(SagaOrchestrator);
    });
  });

  describe('SagaOrchestrator', () => {
    it('should execute all steps in order', async () => {
      const saga = createSaga<TestContext>()
        .addStep({
          name: 'step1',
          execute: async (ctx) => ({
            ...ctx,
            value: ctx.value + 1,
            steps: [...ctx.steps, 'step1'],
          }),
        })
        .addStep({
          name: 'step2',
          execute: async (ctx) => ({
            ...ctx,
            value: ctx.value * 2,
            steps: [...ctx.steps, 'step2'],
          }),
        })
        .addStep({
          name: 'step3',
          execute: async (ctx) => ({
            ...ctx,
            value: ctx.value + 10,
            steps: [...ctx.steps, 'step3'],
          }),
        });

      const result = await saga.execute({ value: 5, steps: [] });

      expect(result.success).toBe(true);
      expect(result.context.value).toBe(22); // (5+1)*2+10
      expect(result.context.steps).toEqual(['step1', 'step2', 'step3']);
      expect(result.completedSteps).toEqual(['step1', 'step2', 'step3']);
    });

    it('should run compensation on failure', async () => {
      const compensateFn = vi.fn();

      const saga = createSaga<TestContext>()
        .addStep({
          name: 'step1',
          execute: async (ctx) => ({
            ...ctx,
            steps: [...ctx.steps, 'step1'],
          }),
          compensate: compensateFn,
        })
        .addStep({
          name: 'step2',
          execute: async (ctx) => {
            if (ctx.shouldFail) {
              throw new Error('Step 2 failed');
            }
            return { ...ctx, steps: [...ctx.steps, 'step2'] };
          },
        });

      const result = await saga.execute({ value: 0, steps: [], shouldFail: true });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Step 2 failed');
      expect(result.failedStep).toBe('step2');
      expect(compensateFn).toHaveBeenCalledTimes(1);
    });

    it('should compensate in reverse order', async () => {
      const compensationOrder: string[] = [];

      const saga = createSaga<TestContext>()
        .addStep({
          name: 'step1',
          execute: async (ctx) => ({ ...ctx, steps: [...ctx.steps, 'step1'] }),
          compensate: async () => {
            compensationOrder.push('comp1');
          },
        })
        .addStep({
          name: 'step2',
          execute: async (ctx) => ({ ...ctx, steps: [...ctx.steps, 'step2'] }),
          compensate: async () => {
            compensationOrder.push('comp2');
          },
        })
        .addStep({
          name: 'step3',
          execute: async () => {
            throw new Error('Failed');
          },
        });

      await saga.execute({ value: 0, steps: [] });

      expect(compensationOrder).toEqual(['comp2', 'comp1']);
    });

    it('should continue compensation even if one fails', async () => {
      const compensationOrder: string[] = [];

      const saga = createSaga<TestContext>()
        .addStep({
          name: 'step1',
          execute: async (ctx) => ({ ...ctx, steps: [...ctx.steps, 'step1'] }),
          compensate: async () => {
            compensationOrder.push('comp1');
          },
        })
        .addStep({
          name: 'step2',
          execute: async (ctx) => ({ ...ctx, steps: [...ctx.steps, 'step2'] }),
          compensate: async () => {
            compensationOrder.push('comp2');
            throw new Error('Compensation failed');
          },
        })
        .addStep({
          name: 'step3',
          execute: async () => {
            throw new Error('Failed');
          },
        });

      await saga.execute({ value: 0, steps: [] });

      // Both compensations should run even though comp2 threw
      expect(compensationOrder).toEqual(['comp2', 'comp1']);
    });

    it('should return completed steps on success', async () => {
      const saga = createSaga<TestContext>()
        .addStep({
          name: 'first',
          execute: async (ctx) => ctx,
        })
        .addStep({
          name: 'second',
          execute: async (ctx) => ctx,
        });

      const result = await saga.execute({ value: 0, steps: [] });

      expect(result.completedSteps).toEqual(['first', 'second']);
    });
  });
});
