import { afterEach, describe, expect, it, vi } from 'vitest';
import { RectoDB } from '../src/state/persistence';
import { stateManager } from '../src/state/stateManager';

describe('IndexedDB save durability', () => {
  afterEach(() => vi.restoreAllMocks());

  function transactionFixture() {
    const put = vi.fn();
    const transaction = {
      objectStore: () => ({ put }),
      oncomplete: null,
      onabort: null,
      onerror: null,
      error: null,
    } as unknown as IDBTransaction;
    vi.spyOn(RectoDB, 'getDB').mockResolvedValue({ transaction: () => transaction } as unknown as IDBDatabase);
    return { transaction, put };
  }

  it('waits for transaction commit before reporting a successful save', async () => {
    const { transaction, put } = transactionFixture();
    const completed = vi.fn();
    const save = RectoDB.saveProject(stateManager.getState(), 123).then(completed);
    await Promise.resolve();
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: 123 }));
    expect(completed).not.toHaveBeenCalled();
    transaction.oncomplete!.call(transaction, new Event('complete'));
    await save;
    expect(completed).toHaveBeenCalledOnce();
  });

  it('rejects a transaction that aborts after the write request', async () => {
    const { transaction } = transactionFixture();
    const save = RectoDB.saveProject(stateManager.getState());
    const rejection = expect(save).rejects.toThrow('Autosave transaction aborted');
    await Promise.resolve();
    transaction.onabort!.call(transaction, new Event('abort'));
    await rejection;
  });
});
