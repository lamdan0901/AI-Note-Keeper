import { describe, expect, it, jest } from '@jest/globals';
import { ExecutionMethod } from 'appwrite';
import { AppwriteBackendClient } from '../../packages/shared/backend/appwrite';

const createAccount = () => ({}) as any;

const createDelegate = () =>
  ({
    preflightUserDataMerge: jest.fn(),
    applyUserDataMerge: jest.fn(),
  }) as any;

const createFunctions = () =>
  ({
    createExecution: jest.fn(),
  }) as any;

describe('AppwriteBackendClient merge configuration', () => {
  it('throws a configuration error instead of delegating preflight merge to Convex', async () => {
    const delegate = createDelegate();
    const functions = createFunctions();
    const client = new AppwriteBackendClient(
      createAccount(),
      delegate,
      undefined,
      functions,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    await expect(
      client.preflightUserDataMerge('device-user', 'appwrite-user', 'alice', 'password123'),
    ).rejects.toThrow(/APPWRITE_USER_DATA_MIGRATION_FUNCTION_ID/);

    expect(delegate.preflightUserDataMerge).not.toHaveBeenCalled();
    expect(functions.createExecution).not.toHaveBeenCalled();
  });

  it('throws a configuration error instead of delegating apply merge to Convex', async () => {
    const delegate = createDelegate();
    const functions = createFunctions();
    const client = new AppwriteBackendClient(
      createAccount(),
      delegate,
      undefined,
      functions,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    await expect(
      client.applyUserDataMerge('device-user', 'appwrite-user', 'alice', 'password123', 'cloud'),
    ).rejects.toThrow(/APPWRITE_USER_DATA_MIGRATION_FUNCTION_ID/);

    expect(delegate.applyUserDataMerge).not.toHaveBeenCalled();
    expect(functions.createExecution).not.toHaveBeenCalled();
  });

  it('uses the Appwrite user-data-migration function when configured', async () => {
    const delegate = createDelegate();
    const functions = createFunctions();
    functions.createExecution.mockResolvedValue({
      responseBody: JSON.stringify({
        sourceEmpty: false,
        sourceSampleOnly: false,
        targetEmpty: true,
        hasConflicts: false,
        sourceCounts: { notes: 1, subscriptions: 0, tokens: 0, events: 0 },
        targetCounts: { notes: 0, subscriptions: 0, tokens: 0, events: 0 },
      }),
    });

    const client = new AppwriteBackendClient(
      createAccount(),
      delegate,
      undefined,
      functions,
      undefined,
      undefined,
      undefined,
      undefined,
      'migration-fn-id',
    );

    const summary = await client.preflightUserDataMerge(
      'device-user',
      'appwrite-user',
      'alice',
      'password123',
    );

    expect(functions.createExecution).toHaveBeenCalledWith(
      'migration-fn-id',
      JSON.stringify({
        fromUserId: 'device-user',
        toUserId: 'appwrite-user',
        username: 'alice',
        password: 'password123',
      }),
      false,
      '/preflight',
      ExecutionMethod.POST,
    );
    expect(delegate.preflightUserDataMerge).not.toHaveBeenCalled();
    expect(summary.targetEmpty).toBe(true);
  });

  it('uses the Appwrite user-data-migration function for apply when configured', async () => {
    const delegate = createDelegate();
    const functions = createFunctions();
    functions.createExecution.mockResolvedValue({
      responseBody: JSON.stringify({}),
    });

    const client = new AppwriteBackendClient(
      createAccount(),
      delegate,
      undefined,
      functions,
      undefined,
      undefined,
      undefined,
      undefined,
      'migration-fn-id',
    );

    await client.applyUserDataMerge(
      'device-user',
      'appwrite-user',
      'alice',
      'password123',
      'cloud',
    );

    expect(functions.createExecution).toHaveBeenCalledWith(
      'migration-fn-id',
      JSON.stringify({
        fromUserId: 'device-user',
        toUserId: 'appwrite-user',
        username: 'alice',
        password: 'password123',
        strategy: 'cloud',
      }),
      false,
      '/apply',
      ExecutionMethod.POST,
    );
    expect(delegate.applyUserDataMerge).not.toHaveBeenCalled();
  });

  it('surfaces malformed function responses clearly', async () => {
    const delegate = createDelegate();
    const functions = createFunctions();
    functions.createExecution.mockResolvedValue({
      responseBody: 'not-json',
    });

    const client = new AppwriteBackendClient(
      createAccount(),
      delegate,
      undefined,
      functions,
      undefined,
      undefined,
      undefined,
      undefined,
      'migration-fn-id',
    );

    await expect(
      client.preflightUserDataMerge('device-user', 'appwrite-user', 'alice', 'password123'),
    ).rejects.toThrow(/invalid response from Appwrite user-data-migration function/);
  });

  it('surfaces structured function errors clearly', async () => {
    const delegate = createDelegate();
    const functions = createFunctions();
    functions.createExecution.mockResolvedValue({
      responseBody: JSON.stringify({ error: 'Permission denied', status: 403 }),
    });

    const client = new AppwriteBackendClient(
      createAccount(),
      delegate,
      undefined,
      functions,
      undefined,
      undefined,
      undefined,
      undefined,
      'migration-fn-id',
    );

    await expect(
      client.preflightUserDataMerge('device-user', 'appwrite-user', 'alice', 'password123'),
    ).rejects.toThrow(/user-data-migration preflight error: Permission denied \(status 403\)/);
  });
});
