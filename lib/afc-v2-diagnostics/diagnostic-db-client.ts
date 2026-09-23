/**
 * Structural PostgREST client used by AFD server stores.
 *
 * Tests inject partial query doubles, so this is not `SupabaseClient`.
 * A single non-generic recursive builder is also not assignable from the
 * service-role client (TypeScript reports an excessively deep instantiation).
 * Each store constrains only the methods it calls. Filter methods return the
 * same inferred chain, which both the real client and those doubles satisfy.
 */

export type AfcDiagnosticQueryResult = {
  data: unknown;
  error: unknown;
};

export type AfcDiagnosticPendingQuery = PromiseLike<AfcDiagnosticQueryResult>;

/**
 * Thenable query whose awaited value is `{ data, error }`.
 * Intentionally looser than `PromiseLike` so doubles whose `then` does not
 * accept `null` stay assignable.
 */
export type AfcDiagnosticAwaitableQuery = {
  then(
    onfulfilled?: (value: AfcDiagnosticQueryResult) => unknown,
    onrejected?: (reason: unknown) => unknown,
  ): PromiseLike<unknown>;
};

export type AfcDiagnosticSelectedQuery = AfcDiagnosticAwaitableQuery & {
  maybeSingle(): AfcDiagnosticPendingQuery;
};

export type AfcDiagnosticFilterOps<S> = {
  eq(column: string, value: unknown): S;
  neq(column: string, value: unknown): S;
  in(column: string, values: readonly unknown[]): S;
  contains(column: string, value: readonly unknown[]): S;
  gte(column: string, value: unknown): S;
  lte(column: string, value: unknown): S;
  or(filters: string): S;
  order(column: string, options?: { ascending?: boolean }): S;
  limit(count: number): S;
  not(column: string, operator: string, value: unknown): S;
  maybeSingle(): AfcDiagnosticPendingQuery;
};

export type AfcDiagnosticFilterQuery<
  S,
  K extends keyof AfcDiagnosticFilterOps<S>,
> = Pick<AfcDiagnosticFilterOps<S>, K>;

export type AfcDiagnosticSelectHead<S> = {
  select(columns: string): S;
};

/** Insert/update chain that filters, then selects a row or a maybe-single row. */
export type AfcDiagnosticWriteQuery<M> = {
  select(columns: string): AfcDiagnosticSelectedQuery;
  eq(column: string, value: unknown): M;
  neq(column: string, value: unknown): M;
};

/** Insert chain that only selects the inserted row. */
export type AfcDiagnosticInsertQuery = {
  select(columns: string): {
    maybeSingle(): AfcDiagnosticPendingQuery;
  };
};

export type AfcDiagnosticTableClient<TQuery> = {
  from(table: string): TQuery;
};
