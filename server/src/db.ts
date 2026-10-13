import postgres from "postgres";

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]>;
  transaction<R>(work: (tx: Db) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

type Runner = postgres.Sql | postgres.TransactionSql;

function wrap(runner: Runner, root: postgres.Sql, inTransaction: boolean): Db {
  return {
    async query<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      const rows = await runner.unsafe(text, params as never[]);
      return [...rows] as T[];
    },
    async transaction<R>(work: (tx: Db) => Promise<R>): Promise<R> {
      if (inTransaction) {
        return work(wrap(runner, root, true));
      }
      return (await root.begin((tx) => work(wrap(tx, root, true)))) as R;
    },
    async close(): Promise<void> {
      await root.end({ timeout: 5 });
    },
  };
}

export function postgresDb(url: string): Db {
  const sql = postgres(url, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  return wrap(sql, sql, false);
}
