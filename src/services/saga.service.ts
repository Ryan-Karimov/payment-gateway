import { logger } from '../utils/logger.js';

export interface SagaStep<TContext> {
  name: string;
  execute: (context: TContext) => Promise<TContext>;
  compensate?: (context: TContext) => Promise<void>;
}

export interface SagaResult<TContext> {
  success: boolean;
  context: TContext;
  error?: Error;
  failedStep?: string;
  completedSteps: string[];
}

export class SagaOrchestrator<TContext extends Record<string, unknown>> {
  private steps: SagaStep<TContext>[] = [];

  addStep(step: SagaStep<TContext>): this {
    this.steps.push(step);
    return this;
  }

  async execute(initialContext: TContext): Promise<SagaResult<TContext>> {
    const completedSteps: SagaStep<TContext>[] = [];
    let context = { ...initialContext };

    try {
      for (const step of this.steps) {
        logger.debug({ step: step.name }, 'Executing saga step');

        context = await step.execute(context);
        completedSteps.push(step);

        logger.debug({ step: step.name }, 'Saga step completed');
      }

      return {
        success: true,
        context,
        completedSteps: completedSteps.map(s => s.name),
      };
    } catch (error) {
      const failedStepIndex = completedSteps.length;
      const failedStep = this.steps[failedStepIndex];

      logger.error(
        { error, step: failedStep?.name },
        'Saga step failed, starting compensation'
      );

      // Execute compensation in reverse order
      for (let i = completedSteps.length - 1; i >= 0; i--) {
        const step = completedSteps[i];
        if (step?.compensate) {
          try {
            logger.debug({ step: step.name }, 'Executing compensation');
            await step.compensate(context);
            logger.debug({ step: step.name }, 'Compensation completed');
          } catch (compensationError) {
            logger.error(
              { error: compensationError, step: step.name },
              'Compensation failed'
            );
          }
        }
      }

      return {
        success: false,
        context,
        error: error instanceof Error ? error : new Error(String(error)),
        failedStep: failedStep?.name,
        completedSteps: completedSteps.map(s => s.name),
      };
    }
  }
}

export function createSaga<TContext extends Record<string, unknown>>(): SagaOrchestrator<TContext> {
  return new SagaOrchestrator<TContext>();
}
